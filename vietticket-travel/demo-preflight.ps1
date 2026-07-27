$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Assert-CommandSucceeded([string]$Label) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Test-HttpEndpoint([string]$Label, [string]$Uri) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 8
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
      throw "HTTP $($response.StatusCode)"
    }
    Write-Host "[PASS] $Label - $Uri" -ForegroundColor Green
  }
  catch {
    throw "[FAIL] $Label - $Uri - $($_.Exception.Message)"
  }
}

# Optional check: khong lam preflight fail neu dich vu chua chay.
function Test-HttpEndpointOptional([string]$Label, [string]$Uri, [string]$Note) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 8
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
      throw "HTTP $($response.StatusCode)"
    }
    Write-Host "[PASS] $Label - $Uri" -ForegroundColor Green
  }
  catch {
    Write-Host "[WARN] $Label khong chay - $Uri - $($_.Exception.Message)" -ForegroundColor Yellow
    if ($Note) { Write-Host "       $Note" -ForegroundColor Yellow }
  }
}

$branch = (& git branch --show-current).Trim()
Assert-CommandSucceeded 'Read Git branch'
$allowedBranches = @('Karma', 'HAnh', 'codex/vietticket-live-autopilot')
if ($allowedBranches -notcontains $branch) {
  throw "Current branch is '$branch'. Checkout one of: $($allowedBranches -join ', ') before the demo."
}
Write-Host "[PASS] Current branch is $branch" -ForegroundColor Green

Test-HttpEndpointOptional 'ML forecast service' 'http://127.0.0.1:8000/health' 'ML khong bat buoc: panel forecast se hien tu cache RevenueForecast da seed. Khong bam "lam moi forecast" khi ML tat.'
Test-HttpEndpoint 'Backend API' 'http://localhost:5000/api/health'
Test-HttpEndpoint 'Frontend Vite' 'http://localhost:5173/'

Push-Location (Join-Path $root 'backend')
try {
  & npm.cmd run demo:check
  Assert-CommandSucceeded 'Demo data check'

  & npm.cmd run demo:llm-check
  Assert-CommandSucceeded 'AI itinerary readiness check'
}
finally {
  Pop-Location
}

Write-Host ''
Write-Host "PRE-FLIGHT PASS: backend, frontend, demo data, AI, and branch $branch are ready (ML optional - dung cache neu tat)." -ForegroundColor Green
Write-Host 'Do not run demo:prepare/demo:smoke after signing in to the demo browser profiles.' -ForegroundColor Yellow
