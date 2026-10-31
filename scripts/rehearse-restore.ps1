param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
$projectPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectPath
$sourceFile = (Get-Item -LiteralPath $BackupFile).FullName
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')
$restorePath = Join-Path $projectPath "backups\restore-rehearsal-$stamp"
New-Item -ItemType Directory -Path $restorePath -ErrorAction Stop | Out-Null
$ownerIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$privateAcl = New-Object System.Security.AccessControl.DirectorySecurity
$privateAcl.SetOwner([System.Security.Principal.NTAccount]::new($ownerIdentity))
$privateAcl.SetAccessRuleProtection($true, $false)
$privateAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($ownerIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $restorePath -AclObject $privateAcl
$statePath = Join-Path $restorePath 'state'
# Every command uses --local and a newly created private persistence directory.
# No Worker is started; notification delivery cannot run during the rehearsal.
$importResult = & npx wrangler d1 execute DB --local --persist-to $statePath --file $sourceFile 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Local import failed. Sensitive SQL output withheld.' }
$migrationResult = & npx wrangler d1 migrations apply DB --local --persist-to $statePath 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Local migration rehearsal failed. Raw output withheld.' }
$sessionResult = & npx wrangler d1 execute DB --local --persist-to $statePath --command 'DELETE FROM auth_sessions;' 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Could not revoke restored local sessions.' }
$query = 'SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM employees) AS employees,(SELECT COUNT(*) FROM hourly_rate_history) AS rates,(SELECT COUNT(*) FROM attendance_sessions) AS attendance,(SELECT COUNT(*) FROM employee_requests) AS requests,(SELECT COUNT(*) FROM payroll_snapshots) AS snapshots,(SELECT COUNT(*) FROM auth_sessions) AS sessions; PRAGMA foreign_key_check;'
$checkResult = & npx wrangler d1 execute DB --local --persist-to $statePath --command $query --json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Local restore integrity query failed.' }
$checks = ($checkResult -join "`n") | ConvertFrom-Json
if ($checks[1].results.Count -ne 0) { throw 'Restored local database has foreign-key errors.' }
if ($checks[0].results[0].sessions -ne 0) { throw 'Restored sessions were not revoked.' }
$report = [ordered]@{ sourceSha256=(Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash; sourceBytes=(Get-Item -LiteralPath $sourceFile).Length; localState=$statePath; counts=$checks[0].results[0]; foreignKeyErrors=0 }
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $restorePath 'report.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 4
