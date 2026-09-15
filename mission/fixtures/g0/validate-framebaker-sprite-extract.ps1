$ErrorActionPreference = 'Stop'
$schemaPath = Join-Path $PSScriptRoot 'framebaker-monster-sprite-extract-v1.schema.json'
$samplePath = Join-Path $PSScriptRoot 'framebaker-monster-sprite-extract.valid.json'
$casePath = Join-Path $PSScriptRoot 'framebaker-monster-sprite-extract.schema-cases.json'
$sample = Get-Content -LiteralPath $samplePath -Raw | ConvertFrom-Json -AsHashtable
$cases = Get-Content -LiteralPath $casePath -Raw | ConvertFrom-Json -AsHashtable

function Copy-Value($value) {
    ConvertTo-Json -InputObject $value -Depth 30 | ConvertFrom-Json -AsHashtable
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

function Test-CrossFields($value) {
    if ($value.objectOriginPx.x -gt $value.canvas.width -or $value.objectOriginPx.y -gt $value.canvas.height) {
        return $false
    }
    $actionIds = @{}
    $allPaths = @{}
    foreach ($action in $value.actions) {
        if ($actionIds.ContainsKey($action.actionId)) { return $false }
        $actionIds[$action.actionId] = $true
        $expectedStart = 0
        foreach ($frame in $action.frames) {
            if ($frame.startTimeMs -ne $expectedStart) { return $false }
            if ($allPaths.ContainsKey($frame.relativePath)) { return $false }
            $allPaths[$frame.relativePath] = $true
            $anchorIds = @{}
            foreach ($anchor in $frame.anchors) {
                if ($anchorIds.ContainsKey($anchor.id)) { return $false }
                if ($anchor.x -gt $value.canvas.width -or $anchor.y -gt $value.canvas.height) { return $false }
                $anchorIds[$anchor.id] = $true
            }
            $expectedStart += $frame.durationMs
        }
        foreach ($marker in $action.markers) {
            if ($marker.atMs -ge $expectedStart) { return $false }
        }
    }
    return $true
}

$sampleJson = ConvertTo-Json -InputObject $sample -Depth 30
if (-not (Test-Json -Json $sampleJson -SchemaFile $schemaPath)) {
    throw 'Positive FrameBaker sprite extract sample rejected'
}
$passed = 1
foreach ($case in $cases) {
    $copy = Copy-Value $sample
    Set-PathValue $copy $case.field $case.value
    $actual = Test-Json -Json (ConvertTo-Json -InputObject $copy -Depth 30) -SchemaFile $schemaPath -ErrorAction SilentlyContinue
    if ($actual -ne $case.valid) {
        throw "Unexpected schema result: $($case.name)"
    }
    $passed++
}

# JSON Schema cannot express these uniqueness and timeline relationships.
if (-not (Test-CrossFields $sample)) { throw 'Positive sample failed cross-field checks' }
$crossFieldCases = @(
    @{ name = 'duplicate-action-id'; field = 'actions.1.actionId'; value = 'monster-01-idle' },
    @{ name = 'non-contiguous-frame'; field = 'actions.0.frames.1.startTimeMs'; value = 43 },
    @{ name = 'marker-at-action-end'; field = 'actions.1.markers.0.atMs'; value = 42 },
    @{ name = 'origin-outside-canvas'; field = 'objectOriginPx.x'; value = 257 },
    @{ name = 'anchor-outside-canvas'; field = 'actions.1.frames.0.anchors.0.x'; value = 257 }
)
foreach ($case in $crossFieldCases) {
    $copy = Copy-Value $sample
    Set-PathValue $copy $case.field $case.value
    if (Test-CrossFields $copy) { throw "Cross-field negative accepted: $($case.name)" }
    $passed++
}

Write-Output "FrameBaker sprite extract R1 frozen contract cases passed: $passed; validates Boundary A source material only."
