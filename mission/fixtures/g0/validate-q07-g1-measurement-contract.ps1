# Requires PowerShell 7. Validates the frozen Q-07 measurement contract, not a performance run.
$ErrorActionPreference = 'Stop'

$contractPath = Join-Path $PSScriptRoot 'q07-g1-measurement-contract-v1.json'
$contract = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json -AsHashtable
$passed = 0

function Assert-Equal($actual, $expected, [string]$label) {
    if ($actual -ne $expected) { throw "$label expected '$expected', got '$actual'" }
    $script:passed++
}

function Assert-Contains($values, [string]$expected, [string]$label) {
    if ($expected -notin $values) { throw "$label is missing '$expected'" }
    $script:passed++
}

Assert-Equal $contract.schemaVersion 1 'schemaVersion'
Assert-Equal $contract.contractId 'liaf-q07-g1-measurement-v1' 'contractId'
Assert-Equal $contract.status 'frozen-method-and-minimum-thresholds; no measurement result is included' 'status'
Assert-Equal $contract.sampleWindow.minimumWallClockSeconds 60 'minimumWallClockSeconds'
Assert-Equal $contract.sampleWindow.minimumRenderedFrames 600 'minimumRenderedFrames'
Assert-Equal $contract.fixtures.a1Pair.requiredEntityCount 2 'A1 entity count'
Assert-Equal $contract.fixtures.a1Pair.requiredTemplateId 'a1_drone' 'A1 template'
Assert-Equal $contract.fixtures.a1Pair.requiredDistinctEntityIds $true 'distinct A1 entity IDs'
Assert-Equal $contract.fixtures.a1Pair.sampleRateHz 24 'A1 sample rate'
foreach ($scenario in @('normal', 'duplicate', 'out_of_order', 'late', 'rebase')) {
    Assert-Contains $contract.fixtures.requiredScenarios.id $scenario 'required scenario'
}
Assert-Equal $contract.hardFailThresholds.osc.maxEncodedCommandBytes 65536 'OSC byte limit'
Assert-Equal $contract.hardFailThresholds.osc.maxCommandsPerRollingSecond 120 'OSC command-rate limit'
Assert-Equal $contract.hardFailThresholds.osc.maxUnexpectedStaleOrRejectedCommandSequences 0 'unexpected OSC stale/rejected limit'
Assert-Equal $contract.hardFailThresholds.timeline.maxContinuousSegmentAbsoluteDriftMs 42 'timeline drift limit'
Assert-Equal $contract.hardFailThresholds.timeline.maxObservedPresentationFrameIntervalMs 250 'max frame interval'
Assert-Equal $contract.hardFailThresholds.timeline.stallIntervalMs 700 'stall interval'
Assert-Equal $contract.hardFailThresholds.timeline.maxStallIntervals 0 'stall count'
foreach ($cap in @(@('maxEntities', 20), @('maxParticles', 100), @('maxEffectPrimitives', 64), @('maxCharacters', 8))) {
    Assert-Equal $contract.hardFailThresholds.sceneCaps[$cap[0]] $cap[1] "scene cap $($cap[0])"
}
foreach ($operation in @('successful refresh', 'failed refresh retaining previous preview', 'rerun', 'reconnect/rebase', 'normal exit')) {
    Assert-Contains $contract.hardFailThresholds.lifecycle.requiredOperations $operation 'lifecycle operation'
}
foreach ($field in @('archiveBytes', 'archiveUncompressedBytes', 'pngBytes', 'rgbaDecodedBytes', 'cacheDiskBytes')) {
    Assert-Contains $contract.requiredRecordedMeasurements.resources $field 'resource measurement'
}
foreach ($pending in @('aggregate archive, decode, RGBA, texture, disk-cache, and retained-resource budgets', 'p95/p99 frame latency', 'network transport latency and G2 real reconnect behavior')) {
    Assert-Contains $contract.evaluation.pendingRealMeasurement $pending 'pending measurement'
}
foreach ($notPassable in @('C-02 implementation or consumer acceptance', 'C-04 cache implementation or acceptance', 'G0 completion', 'G1 completion')) {
    Assert-Contains $contract.evaluation.notPassableFromThisContract $notPassable 'not-passable claim'
}

Write-Output "Q-07 G1 measurement contract cases passed: $passed. This validates the frozen method only; it is not a performance result or G0/G1/C-02/C-04 acceptance."
