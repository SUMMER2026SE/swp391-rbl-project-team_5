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

$branch = (& git branch --show-current).Trim()
Assert-CommandSucceeded 'Read Git branch'
if ($branch -ne 'HAnh') {
  throw "Current branch is '$branch'. Checkout 'HAnh' before the demo."
}
Write-Host '[PASS] Current branch is HAnh' -ForegroundColor Green

Test-HttpEndpoint 'ML forecast service' 'http://127.0.0.1:8000/health'
Test-HttpEndpoint 'Backend API' 'http://localhost:5000/api/health'
Test-HttpEndpoint 'Frontend Vite' 'http://localhost:5173/'

Push-Location (Join-Path $root 'backend')
try {
  & npm.cmd run demo:check
  Assert-CommandSucceeded 'Demo data check'

  & npm.cmd run demo:llm-check
  Assert-CommandSucceeded 'LLM provider check'
}
finally {
  Pop-Location
}

Write-Host ''
Write-Host 'PRE-FLIGHT PASS: services, demo data, AI, and branch HAnh are ready.' -ForegroundColor Green
Write-Host 'Do not run demo:prepare/demo:smoke after signing in to the demo browser profiles.' -ForegroundColor Yellow
