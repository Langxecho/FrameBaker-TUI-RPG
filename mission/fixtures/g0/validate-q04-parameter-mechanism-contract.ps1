$ErrorActionPreference = 'Stop'
$contractPath = Join-Path $PSScriptRoot 'q04-parameter-mechanism-contract-v1.json'
$contract = Get-Content -LiteralPath $contractPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($contract.format -ne 'tui-idle-rpg.q04-parameter-mechanism-contract' -or $contract.schemaVersion -ne 1) {
    throw 'Q-04 contract format or schema version is invalid'
}
if ($contract.publicParameters.Count -ne 4) {
    throw 'Q-04 contract must contain exactly four public parameters'
}
foreach ($parameter in $contract.publicParameters) {
    if ($parameter.type -ne 'integer' -or $parameter.minimum -gt $parameter.maximum) {
        throw "Invalid public parameter: $($parameter.field)"
    }
}
foreach ($digest in @($contract.identities.registryVersion, $contract.identities.mechanismCatalogSha256) + @($contract.identities.mechanismCompatibilitySha256.PSObject.Properties.Value)) {
    if ($digest -notmatch '^[0-9a-f]{64}$') { throw "Invalid SHA-256 identity: $digest" }
}

$serverManifest = Join-Path $PSScriptRoot '..\..\..\server\Cargo.toml'
cargo test --manifest-path $serverManifest --test q04_parameter_contract -- --test-threads=1
if ($LASTEXITCODE -ne 0) { throw 'Q-04 Rust contract binding failed' }
Write-Output 'Q-04 parameter/mechanism contract fixture and live Rust catalog binding passed.'
