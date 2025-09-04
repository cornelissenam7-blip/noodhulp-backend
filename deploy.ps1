# deploy.ps1
param (
    [string]$Message = "Update backend"
)

Write-Host "🔄 Backend deploy wordt gestart..."

# Voeg alle wijzigingen toe
git add -A

# Commit met bericht
git commit -m $Message

# Push naar main branch
git push origin main

Write-Host "✅ Code gepusht naar GitHub. Render zal automatisch opnieuw deployen."
