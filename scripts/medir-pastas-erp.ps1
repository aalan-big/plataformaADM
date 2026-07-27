<#
    medir-pastas-erp.ps1
    ---------------------------------------------------------------------------
    Mede a pasta de dados do ERP local para dimensionar o backup em nuvem.

    Não escreve nada, não apaga nada, não envia nada para lugar nenhum — só lê
    tamanhos e datas e imprime na tela. Pode rodar com o ERP aberto.

    COMO USAR (na máquina do cliente):
      1. Botão direito no Iniciar → Terminal (ou PowerShell)
      2. Ajuste o caminho abaixo, ou passe por parâmetro:
         .\medir-pastas-erp.ps1 -Raiz "C:\ERP\dados"
      3. Copie a tabela inteira e mande de volta.

    O QUE A SAÍDA RESPONDE:
      - qual pasta domina o tamanho (produtos? ordens de serviço?)
      - o tamanho real médio das fotos, como o ERP grava hoje
      - quanto entrou nos últimos 30 e 90 dias = a TAXA DE CRESCIMENTO,
        que é o número que decide o desenho do backup de imagens
    ---------------------------------------------------------------------------
#>

param(
    [string] $Raiz = "C:\caminho\para\dados"
)

if (-not (Test-Path $Raiz)) {
    Write-Host "Caminho nao encontrado: $Raiz" -ForegroundColor Red
    Write-Host "Rode de novo apontando para a pasta de dados do ERP:" -ForegroundColor Yellow
    Write-Host '  .\medir-pastas-erp.ps1 -Raiz "C:\ERP\dados"' -ForegroundColor Yellow
    exit 1
}

Write-Host "Medindo $Raiz ..." -ForegroundColor Cyan
Write-Host "(pode demorar alguns minutos se houver muitos arquivos)`n"

$corte30 = (Get-Date).AddDays(-30)
$corte90 = (Get-Date).AddDays(-90)

$linhas = Get-ChildItem $Raiz -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $arqs = Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue

    if (-not $arqs -or $arqs.Count -eq 0) {
        return [PSCustomObject]@{
            Pasta = $_.Name; Total_MB = 0; Arquivos = 0; Media_KB = 0
            Ult30d_MB = 0; Ult30d_Qtd = 0; Ult90d_MB = 0; Mais_Antigo = $null
        }
    }

    # CreationTime é o que importa: foto de OS é escrita uma vez e nunca mais
    # tocada, então a data de criação é a data real de entrada do dado.
    $n30 = $arqs | Where-Object { $_.CreationTime -gt $corte30 }
    $n90 = $arqs | Where-Object { $_.CreationTime -gt $corte90 }

    [PSCustomObject]@{
        Pasta       = $_.Name
        Total_MB    = [math]::Round(($arqs | Measure-Object -Sum Length).Sum / 1MB, 1)
        Arquivos    = $arqs.Count
        Media_KB    = [math]::Round(($arqs | Measure-Object -Average Length).Average / 1KB, 1)
        Ult30d_MB   = [math]::Round((($n30 | Measure-Object -Sum Length).Sum) / 1MB, 1)
        Ult30d_Qtd  = $n30.Count
        Ult90d_MB   = [math]::Round((($n90 | Measure-Object -Sum Length).Sum) / 1MB, 1)
        Mais_Antigo = ($arqs | Sort-Object CreationTime | Select-Object -First 1).CreationTime.ToString('yyyy-MM-dd')
    }
} | Sort-Object Total_MB -Descending

$linhas | Format-Table -AutoSize

$totalMB = [math]::Round((($linhas | Measure-Object -Sum Total_MB).Sum), 1)
$cresc30 = [math]::Round((($linhas | Measure-Object -Sum Ult30d_MB).Sum), 1)

Write-Host "TOTAL: $totalMB MB" -ForegroundColor Green
Write-Host "Entrou nos ultimos 30 dias: $cresc30 MB" -ForegroundColor Green

# O teto atual de um pacote de backup é 500 MB. Projetar a data do estouro é o
# que transforma "tem folga" em uma data no calendário, que é o que decide se a
# mudança de desenho entra agora ou no trimestre que vem.
if ($cresc30 -gt 0) {
    $faltamMB = 500 - $totalMB
    $meses    = [math]::Round($faltamMB / $cresc30, 1)
    if ($faltamMB -le 0) {
        Write-Host "JA PASSOU do teto de 500 MB por pacote." -ForegroundColor Red
    } else {
        Write-Host "No ritmo atual, atinge 500 MB em ~$meses meses." -ForegroundColor Yellow
    }
}
