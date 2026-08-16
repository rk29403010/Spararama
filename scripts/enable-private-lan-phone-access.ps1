#Requires -RunAsAdministrator
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$ruleName = 'Spararama phone UI (private LAN)'
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodePath = $nodeCommand.Source

function Get-SubnetCidr {
  param(
    [Parameter(Mandatory)] [string] $IPAddress,
    [Parameter(Mandatory)] [byte] $PrefixLength
  )

  if ($PrefixLength -lt 1 -or $PrefixLength -gt 30) {
    throw "Refusing to create a phone-access rule for unsafe IPv4 prefix length /$PrefixLength."
  }

  $addressBytes = [System.Net.IPAddress]::Parse($IPAddress).GetAddressBytes()
  $networkBytes = [byte[]]::new(4)
  $bitsRemaining = [int] $PrefixLength
  for ($index = 0; $index -lt 4; $index += 1) {
    $mask = if ($bitsRemaining -ge 8) {
      255
    } elseif ($bitsRemaining -le 0) {
      0
    } else {
      [int] (256 - [Math]::Pow(2, 8 - $bitsRemaining))
    }
    $networkBytes[$index] = $addressBytes[$index] -band $mask
    $bitsRemaining -= 8
  }

  return "$(($networkBytes -join '.'))/$PrefixLength"
}

function Disable-BroadNodeInboundRules {
  # These are Windows' generic rules created by the Node.js firewall prompt.
  # They allow every inbound port from every remote address and would override
  # the narrow Spararama allow rule below. Disable rather than delete them so
  # the prior setting remains recoverable with Enable-NetFirewallRule.
  $candidates = @(
    Get-NetFirewallRule -PolicyStore PersistentStore -DisplayName 'Node.js JavaScript Runtime' -ErrorAction SilentlyContinue
  ) + @(
    Get-NetFirewallRule -PolicyStore PersistentStore -DisplayName 'node.exe' -ErrorAction SilentlyContinue
  ) | Where-Object {
    $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow'
  }

  $disabled = @()
  foreach ($candidate in $candidates) {
    $application = @($candidate | Get-NetFirewallApplicationFilter)
    $port = @($candidate | Get-NetFirewallPortFilter)
    $address = @($candidate | Get-NetFirewallAddressFilter)
    $isBroadNodeRule =
      ($application.Program -match '(?i)\\node\.exe$') -and
      ($port.LocalPort -contains 'Any') -and
      ($address.RemoteAddress -contains 'Any')

    if ($isBroadNodeRule) {
      Disable-NetFirewallRule -InputObject $candidate
      $disabled += $candidate.DisplayName
    }
  }

  if ($disabled.Count -gt 0) {
    Write-Output "Disabled $($disabled.Count) broad inbound Node.js firewall rule(s)."
  }
}

$privateProfiles = @(
  Get-NetConnectionProfile |
    Where-Object { $_.NetworkCategory -eq 'Private' -and $_.IPv4Connectivity -ne 'Disconnected' }
)

$lanBindings = @(
  foreach ($profile in $privateProfiles) {
    Get-NetIPAddress -InterfaceIndex $profile.InterfaceIndex -AddressFamily IPv4 |
      Where-Object {
        $_.AddressState -eq 'Preferred' -and
        -not $_.SkipAsSource -and
        $_.PrefixLength -ge 1 -and
        $_.PrefixLength -le 30 -and
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*'
      } |
      ForEach-Object {
        [PSCustomObject]@{
          InterfaceAlias = $profile.InterfaceAlias
          IPAddress = $_.IPAddress
          PrefixLength = [byte] $_.PrefixLength
        }
      }
  }
)

if ($lanBindings.Count -ne 1) {
  throw "Expected exactly one active private IPv4 LAN address, found $($lanBindings.Count). Refusing to widen the firewall rule."
}

$binding = $lanBindings[0]
$remoteCidr = Get-SubnetCidr -IPAddress $binding.IPAddress -PrefixLength $binding.PrefixLength

Disable-BroadNodeInboundRules

# Replacing only this explicitly named, locally managed rule makes reruns safe
# when DHCP changes the laptop address or the private subnet.
Get-NetFirewallRule -PolicyStore PersistentStore -DisplayName $ruleName -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule

$rule = New-NetFirewallRule `
  -PolicyStore PersistentStore `
  -DisplayName $ruleName `
  -Description 'Allows Spararama phone UI only from this private LAN subnet.' `
  -Group 'Spararama' `
  -Enabled True `
  -Profile Private `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalAddress $binding.IPAddress `
  -LocalPort 3000 `
  -RemoteAddress $remoteCidr `
  -Program $nodePath `
  -InterfaceAlias $binding.InterfaceAlias `
  -EdgeTraversalPolicy Block

Write-Output "Created firewall rule: $($rule.DisplayName)"
Write-Output "Phone UI: http://$($binding.IPAddress):3000"
Write-Output "Inbound scope: private profile, $($binding.InterfaceAlias), $remoteCidr, TCP 3000, $nodePath"
