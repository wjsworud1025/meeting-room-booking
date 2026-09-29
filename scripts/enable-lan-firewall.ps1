# Run in an Administrator PowerShell. This opens only the Wi-Fi test port to the local subnet.
$ErrorActionPreference = 'Stop'
$lanHost = '192.168.10.64'
$lanInterface = 'Wi-Fi'
$lanRuleName = 'Meeting Room Booking LAN Test'
if (-not (Get-NetIPAddress -InterfaceAlias $lanInterface -AddressFamily IPv4 | Where-Object IPAddress -eq $lanHost)) {
    throw 'Wi-Fi IP changed. Update LAN_TEST_HOST and this script before running.'
}
if (-not (Get-NetFirewallRule -DisplayName $lanRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $lanRuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3002 -LocalAddress $lanHost -RemoteAddress LocalSubnet -InterfaceAlias $lanInterface -Profile Any | Out-Null
}
Write-Host 'Wi-Fi local subnet can access TCP 3002. Firewall remains enabled.'
