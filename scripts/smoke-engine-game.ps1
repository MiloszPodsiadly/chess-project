param([switch]$Ultimate)
$ErrorActionPreference = 'Stop'
$baseUrl = 'http://localhost:3000'
$health = Invoke-RestMethod "$baseUrl/api/engine/health"
if ($health.status -ne 'ready' -or $health.metrics.engine -ne 'Stockfish 19') {
    throw 'Stockfish readiness failed through the frontend /api/ proxy'
}

$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$username = "stockfish-smoke-$suffix"
$registration = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/register" `
    -ContentType 'application/json' `
    -Body (@{ username = $username; email = "$username@example.invalid"; password = 'TestOnly-ChangeMe-123!' } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($registration.accessToken)" }
$whiteGame = $null
$blackGame = $null
$ultimateGame = $null
try {
    $whiteGame = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games?playerColor=WHITE&mode=FULL_STRENGTH&preset=STRONG&timeControlType=UNTIMED" -Headers $headers
    if ($whiteGame.turnState -ne 'PLAYER_TURN' -or $whiteGame.moves.Count -ne 0) {
        throw 'White game did not start on the player turn'
    }
    $body = @{ from = 'e2'; to = 'e4'; playerColor = 'WHITE' } | ConvertTo-Json
    $reply = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games/$($whiteGame.gameId)/move?expectedVersion=$($whiteGame.version)" `
        -Headers $headers -ContentType 'application/json' -Body $body
    if ($reply.turnState -ne 'PLAYER_TURN' -or $reply.moves.Count -ne 2 -or $reply.engineMode -ne 'FULL_STRENGTH') {
        throw "Unexpected engine reply: state=$($reply.turnState), moves=$($reply.moves.Count), error=$($reply.engineError)"
    }
    try {
        Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games/$($whiteGame.gameId)/move?expectedVersion=$($whiteGame.version)" `
            -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
        throw 'Duplicate move was accepted'
    } catch {
        if ($_.Exception.Message -eq 'Duplicate move was accepted') { throw }
    }
    $resumed = Invoke-RestMethod -Uri "$baseUrl/api/engine-games/$($whiteGame.gameId)" -Headers $headers
    if ($resumed.moves.Count -ne 2) { throw 'Duplicate request changed game history' }

    $blackGame = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games?playerColor=BLACK&mode=BEGINNER&engineElo=800&timeControlType=UNTIMED" -Headers $headers
    if ($blackGame.turnState -ne 'PLAYER_TURN' -or $blackGame.moves.Count -ne 1 -or $blackGame.sideToMove -ne 'BLACK') {
        throw "Black game failed: state=$($blackGame.turnState), moves=$($blackGame.moves.Count), error=$($blackGame.engineError)"
    }
    if ($Ultimate) {
        $ultimateGame = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games?playerColor=WHITE&mode=FULL_STRENGTH&preset=ULTIMATE&timeControlType=UNTIMED" -Headers $headers
        $ultimateReply = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games/$($ultimateGame.gameId)/move?expectedVersion=$($ultimateGame.version)" `
            -Headers $headers -ContentType 'application/json' -Body $body
        if ($ultimateReply.moves.Count -ne 2 -or $ultimateReply.enginePreset -ne 'ULTIMATE' -or $ultimateReply.turnState -ne 'PLAYER_TURN') {
            throw "Ultimate native reply failed: state=$($ultimateReply.turnState), moves=$($ultimateReply.moves.Count), error=$($ultimateReply.engineError)"
        }
    }
    Write-Output "PASS proxy=ready version=Stockfish19 whiteMoves=$($reply.moves.Count) blackOpeningMoves=$($blackGame.moves.Count) duplicate=blocked ultimate=$Ultimate"
} finally {
    if ($whiteGame) {
        try { Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games/$($whiteGame.gameId)/resign" -Headers $headers | Out-Null } catch {}
    }
    if ($blackGame) {
        try { Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games/$($blackGame.gameId)/resign" -Headers $headers | Out-Null } catch {}
    }
    if ($ultimateGame) {
        try { Invoke-RestMethod -Method Post -Uri "$baseUrl/api/engine-games/$($ultimateGame.gameId)/resign" -Headers $headers | Out-Null } catch {}
    }
}
