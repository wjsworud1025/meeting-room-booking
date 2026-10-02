param([ValidateSet('Install','List','Inspect','ClearHistory','Verify','Members','Rooms','Reservations','History')][string]$Action='List',[string]$LoginId,[string]$Reason)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$keyStore=Join-Path $root '.local/maintenance/railway-maintenance.dpapi'
$keyPath=Join-Path $env:USERPROFILE ('.ssh/booking-maintenance-session-'+[guid]::NewGuid().ToString('N'))
if($Action -in @('Inspect','ClearHistory','Members','Rooms','Reservations','History') -and $LoginId -notmatch '^[a-zA-Z0-9_]{4,32}$'){throw 'Explicit valid LoginId required'}
if($Action -eq 'ClearHistory'){if([string]::IsNullOrWhiteSpace($Reason) -or $Reason.Trim().Length -lt 5 -or $Reason.Length -gt 500){throw 'Explicit Reason (5-500 characters) required'};$encodedReason=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Reason))}
switch($Action){
 'Install' {$sql=Get-Content (Join-Path $PSScriptRoot 'install.sql') -Raw}
 {$_ -in @('Members','Rooms','Reservations','History')} {$view=$Action.ToLowerInvariant();$sql="BEGIN READ ONLY; SET LOCAL ROLE booking_maintenance_reader; SELECT * FROM maintenance.$view WHERE login_id='$LoginId' LIMIT 200; COMMIT;"}
 'List' {$sql='BEGIN READ ONLY; SET LOCAL ROLE booking_maintenance_reader; SELECT * FROM maintenance.customers; COMMIT;'}
 'Inspect' {$sql="BEGIN READ ONLY; SET LOCAL ROLE booking_maintenance_reader; SELECT * FROM maintenance.customers WHERE login_id='$LoginId'; SELECT count(*) audit_count FROM maintenance.history WHERE login_id='$LoginId'; COMMIT;"}
 'ClearHistory' {$sql="BEGIN; SET LOCAL ROLE booking_maintenance_operator; SELECT maintenance.clear_history('$LoginId',convert_from(decode('$encodedReason','base64'),'UTF8')); COMMIT;"}
 'Verify' {$sql="BEGIN READ ONLY; SELECT has_table_privilege('booking_maintenance_reader','booking.members','SELECT') AS reader_raw_access,has_table_privilege('booking_maintenance_reader','booking.audit_events','DELETE') AS reader_delete,has_table_privilege('booking_maintenance_operator','booking.audit_events','DELETE') AS operator_raw_delete,has_function_privilege('booking_maintenance_reader','maintenance.clear_history(text,text)','EXECUTE') AS reader_clear,has_function_privilege('booking_maintenance_operator','maintenance.clear_history(text,text)','EXECUTE') AS operator_clear; SELECT rolname,has_schema_privilege(rolname,'maintenance','USAGE') AS maintenance_access FROM pg_roles WHERE rolname LIKE 'saas_web_%' OR rolname LIKE 'saas_control_%' OR rolname LIKE 'saas_worker_%'; SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('booking_maintenance_reader','booking_maintenance_operator'); SELECT action,login_id,affected_rows,occurred_at FROM maintenance.operations ORDER BY occurred_at DESC LIMIT 5; SELECT count(*) AS protected_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='booking' AND c.relrowsecurity AND c.relforcerowsecurity; COMMIT;"}
}
Add-Type -AssemblyName System.Security
try {
 $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($keyStore),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [IO.File]::WriteAllBytes($keyPath,$bytes);[Array]::Clear($bytes,0,$bytes.Length)
 $maintIdentity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
 icacls $keyPath /inheritance:r /grant:r "${maintIdentity}:F" | Out-Null
 $ssh='C:/Program Files/Git/usr/bin/ssh.exe'
 $sql | & $ssh -T -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -i ($keyPath.Replace('\','/')) '71c2c737-57b1-4255-b8cb-9ba33654e2b4@ssh.railway.com' 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
 if($LASTEXITCODE -ne 0){throw 'Maintenance operation failed'}
} finally {Remove-Item -LiteralPath $keyPath -ErrorAction SilentlyContinue}
