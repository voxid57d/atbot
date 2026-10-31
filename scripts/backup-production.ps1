param([string]$Label = 'manual')
$ErrorActionPreference = 'Stop'
if ($Label -notmatch '^[a-zA-Z0-9-]+$') { throw 'Use a simple backup label.' }
$projectPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectPath
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')
$backupPath = Join-Path $projectPath "backups\$Label-$stamp"
New-Item -ItemType Directory -Path $backupPath -ErrorAction Stop | Out-Null
$ownerIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$privateAcl = New-Object System.Security.AccessControl.DirectorySecurity
$privateAcl.SetOwner([System.Security.Principal.NTAccount]::new($ownerIdentity))
$privateAcl.SetAccessRuleProtection($true, $false)
$privateAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($ownerIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $backupPath -AclObject $privateAcl
$exportFile = Join-Path $backupPath 'database.sql'
$exportResult = & npx wrangler d1 export DB --remote --output $exportFile 2>&1
if ($LASTEXITCODE -ne 0) { throw 'D1 export failed. Raw export output withheld because it can contain signed URLs.' }
$info = Get-Item -LiteralPath $exportFile
if ($info.Length -lt 1000) { throw 'Export unexpectedly small.' }
$metadata = [ordered]@{ database='staff-attendance-db'; utc=$stamp; bytes=$info.Length; sha256=(Get-FileHash -LiteralPath $exportFile -Algorithm SHA256).Hash }
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupPath 'metadata.json') -Encoding UTF8
Write-Output "Private export: $exportFile"
$metadata | ConvertTo-Json -Compress
