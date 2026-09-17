# Requires PowerShell 7. Validates the Q-03 v2 fixture and consumer boundary only.
$ErrorActionPreference = 'Stop'

$schemaPath = Join-Path $PSScriptRoot 'combat-facts-v2.schema.json'
$canonicalPath = Join-Path $PSScriptRoot 'combat-facts-v2.canonical.json'
$negativeCasesPath = Join-Path $PSScriptRoot 'combat-facts-v2.negative-cases.json'
$canonical = Get-Content -LiteralPath $canonicalPath -Raw | ConvertFrom-Json -AsHashtable
$negativeCases = Get-Content -LiteralPath $negativeCasesPath -Raw | ConvertFrom-Json -AsHashtable

function Copy-Value($value) {
    ConvertTo-Json -InputObject $value -Depth 50 | ConvertFrom-Json -AsHashtable
}

function Set-PathValue($root, [string]$path, $value) {
    $parts = $path.Split('.')
    $target = $root
    for ($i = 0; $i -lt $parts.Length - 1; $i++) {
        $part = $parts[$i]
        if ($target -is [System.Collections.IList]) {
            $target = $target[[int]$part]
        } else {
            $target = $target[$part]
        }
    }
    $last = $parts[-1]
    if ($target -is [System.Collections.IList]) {
        $target[[int]$last] = $value
    } else {
        $target[$last] = $value
    }
}

function Get-Sequence([string]$value) {
    if ($null -eq $value -or $value -notmatch '^(0|[1-9][0-9]*)$') {
        throw "Expected canonical decimal sequence, got '$value'"
    }
    return [uint64]::Parse($value, [Globalization.CultureInfo]::InvariantCulture)
}

function Test-AuthoritativeBatch($batch, $priorFacts, [Nullable[uint64]]$priorThrough, [Nullable[uint64]]$priorSimTime) {
    $json = ConvertTo-Json -InputObject $batch -Depth 50
    if (-not (Test-Json -Json $json -SchemaFile $schemaPath -ErrorAction SilentlyContinue)) {
        return $false
    }

    $simTime = [uint64]$batch.simTimeMs
    if ($priorSimTime.HasValue -and $simTime -lt $priorSimTime.Value) { return $false }
    $through = if ($null -eq $batch.throughSequence) { $null } else { Get-Sequence $batch.throughSequence }
    if ($batch.items.Count -gt 0 -and $null -eq $through) { return $false }
    if ($priorThrough.HasValue -and $through -ne $null -and $through -lt $priorThrough.Value) { return $false }

    $entityIds = @{}
    $contentRefs = @{}
    foreach ($source in $batch.contentSources) {
        if ($entityIds.ContainsKey($source.entityId) -or $contentRefs.ContainsKey($source.contentRef)) { return $false }
        $entityIds[$source.entityId] = $true
        $contentRefs[$source.contentRef] = $true
    }

    $previousSequence = $null
    $previousTime = $null
    foreach ($fact in $batch.items) {
        $sequence = Get-Sequence $fact.sequence
        if ($previousSequence -ne $null -and $sequence -ne ($previousSequence + 1)) { return $false }
        if ($previousSequence -eq $null -and $priorThrough.HasValue -and $sequence -ne ($priorThrough.Value + 1)) { return $false }
        if ($priorFacts.ContainsKey($fact.sequence)) { return $false }
        if ($through -ne $null -and $sequence -gt $through) { return $false }
        if ($previousTime -ne $null -and [uint64]$fact.atMs -lt $previousTime) { return $false }
        if (-not $entityIds.ContainsKey($fact.sourceId)) { return $false }
        if ($null -ne $fact.contentRef -and -not $contentRefs.ContainsKey($fact.contentRef)) { return $false }

        if ($fact.kind -eq 'action.launched') {
            if ($null -ne $fact.parentSequence) { return $false }
            foreach ($targetId in $fact.payload.targetIds) {
                if (-not $entityIds.ContainsKey($targetId)) { return $false }
            }
        } elseif ($fact.kind -in @('action.impact', 'action.finished')) {
            if ($null -eq $fact.parentSequence -or -not $priorFacts.ContainsKey($fact.parentSequence)) { return $false }
            $launch = $priorFacts[$fact.parentSequence]
            if ($launch.kind -ne 'action.launched' -or $launch.actionId -ne $fact.actionId) { return $false }
            if ($fact.kind -eq 'action.impact') {
                if (-not $entityIds.ContainsKey($fact.payload.targetId)) { return $false }
                if ($fact.payload.targetId -notin $launch.payload.targetIds) { return $false }
            }
        }

        $priorFacts[$fact.sequence] = $fact
        $previousSequence = $sequence
        $previousTime = [uint64]$fact.atMs
    }
    return $true
}

function Test-AuthoritativeStream($batches) {
    $facts = @{}
    [Nullable[uint64]]$through = $null
    [Nullable[uint64]]$simTime = $null
    foreach ($batch in $batches) {
        if (-not (Test-AuthoritativeBatch $batch $facts $through $simTime)) { return $false }
        if ($null -ne $batch.throughSequence) { $through = Get-Sequence $batch.throughSequence }
        $simTime = [uint64]$batch.simTimeMs
    }
    return $true
}

function Receive-ConsumerBatch($state, $batch) {
    $through = if ($null -eq $batch.throughSequence) { $null } else { Get-Sequence $batch.throughSequence }
    if ($null -ne $state.cursor -and $through -ne $null -and $through -lt $state.cursor) {
        return @()
    }

    # A read-only reconnect snapshot is distinguished by its empty item list.
    # It establishes the waterline and intentionally cannot replay historical impacts.
    if ($batch.items.Count -eq 0) {
        if ($through -ne $null) { $state.cursor = $through }
        return @()
    }

    $received = @()
    foreach ($fact in $batch.items) {
        $sequence = Get-Sequence $fact.sequence
        if ($null -ne $state.cursor -and $sequence -le $state.cursor) { continue }
        if ($null -ne $state.cursor -and $sequence -ne ($state.cursor + 1)) {
            throw "Out-of-order or missing combat fact after sequence $($state.cursor)"
        }
        if ($null -eq $state.cursor -and $sequence -ne 0) {
            throw 'First incremental batch needs sequence 0 or an empty reconnect baseline'
        }
        $received += $fact
        $state.cursor = $sequence
    }
    if ($through -ne $null -and ($null -eq $state.cursor -or $through -gt $state.cursor)) {
        throw "Watermark $through exceeds the received consumer cursor"
    }
    return $received
}

$canonicalJson = ConvertTo-Json -InputObject $canonical -Depth 50
if (-not (Test-Json -Json $canonicalJson -SchemaFile $schemaPath)) {
    throw 'Canonical combatFacts v2 batch was rejected by the schema'
}
if (-not (Test-AuthoritativeStream @($canonical))) {
    throw 'Canonical combatFacts v2 batch failed authoritative sequence/cause checks'
}
$passed = 2

foreach ($case in $negativeCases) {
    $copy = Copy-Value $canonical
    Set-PathValue $copy $case.field $case.value
    if (Test-AuthoritativeStream @($copy)) {
        throw "Negative combatFacts v2 case was accepted: $($case.name)"
    }
    $passed++
}

# Reconnect receives a read-only baseline (empty items plus the latest watermark),
# then only new facts. It must not render the six historical canonical items again.
$baseline = Copy-Value $canonical
$baseline.items = @()
$increment = Copy-Value $canonical
$increment.simTimeMs = 200
$increment.throughSequence = '8'
$increment.items = @(
    @{ sequence = '6'; actionId = 'action-101-1'; parentSequence = $null; atMs = 200; sourceId = '101'; abilityId = 'basic_attack'; contentRef = 'entity:101'; kind = 'action.launched'; payload = @{ targetIds = @('1'); delivery = 'instant' } },
    @{ sequence = '7'; actionId = 'action-101-1'; parentSequence = '6'; atMs = 200; sourceId = '101'; abilityId = 'basic_attack'; contentRef = 'entity:101'; kind = 'action.impact'; payload = @{ targetId = '1'; outcome = 'hit'; resolvedDamage = 10; hpLoss = 10; hpAfter = 63; critical = $false; killed = $false } },
    @{ sequence = '8'; actionId = 'action-101-1'; parentSequence = '6'; atMs = 200; sourceId = '101'; abilityId = 'basic_attack'; contentRef = 'entity:101'; kind = 'action.finished' }
)
if (-not (Test-AuthoritativeStream @($canonical, $baseline, $increment))) {
    throw 'Valid canonical, baseline, and incremental sequence was rejected'
}

$consumer = @{ cursor = $null }
if ((Receive-ConsumerBatch $consumer $baseline).Count -ne 0 -or $consumer.cursor -ne 5) {
    throw 'Reconnect baseline replayed history or failed to establish throughSequence'
}
if ((Receive-ConsumerBatch $consumer $increment).Count -ne 3 -or $consumer.cursor -ne 8) {
    throw 'Consumer did not receive the three new facts after reconnect baseline'
}
if ((Receive-ConsumerBatch $consumer $canonical).Count -ne 0 -or $consumer.cursor -ne 8) {
    throw 'Stale out-of-order batch replayed historical combat facts'
}
$passed += 3

$freshConsumer = @{ cursor = $null }
try {
    Receive-ConsumerBatch $freshConsumer $increment | Out-Null
    throw 'Out-of-order initial incremental batch was accepted without a baseline'
} catch {
    if ($_.Exception.Message -eq 'Out-of-order initial incremental batch was accepted without a baseline') { throw }
}
$passed++

Write-Output "combatFacts v2 Q-03 canonical, negative, and cross-batch consumer cases passed: $passed. Q-07 real measurement, G0/G1, and C-02 remain unaccepted."
