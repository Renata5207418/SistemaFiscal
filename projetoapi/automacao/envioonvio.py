import asyncio
import time
import os
from dotenv import load_dotenv
import pyotp
from playwright.async_api import async_playwright, TimeoutError as PWTimeout, Locator
from requests import Session
from requests.adapters import HTTPAdapter, Retry
from pathlib import Path


load_dotenv()
# ==============================================================================
# CONFIGURAÇÕES GERAIS
# ==============================================================================
URL_PORTAL = "https://onvio.com.br/br-portal-do-cliente/reporting/published-documents"
URL_API = "https://onvio.com.br/api/storage/v1/containers/documents"
CACHE_TOK = ".browser_token.json"

ONVIO_USER = os.getenv("ONVIO_USER")
ONVIO_PASS = os.getenv("ONVIO_PASS")
ONVIO_2FA_SECRET = os.getenv("ONVIO_2FA_SECRET")

TOKEN_TTL = 50 * 60
PAGE_SIZE = 100
MAX_LOGIN_ATTEMPTS = 3
BACKOFF_BASE = 5

BASE_PARAMS = {
    "status": "ACTIVE",
    "loadLock": "false",
    "loadParent": "true",
    "loadContact": "true",
    "loadMetadata": "false",
    "pageSize": str(PAGE_SIZE),
    "sort": "createdDate:desc",
}

READ_TIMEOUT = (5, 120)

def criar_session_com_retries(total_retries: int = 5, backoff: float = 1.5) -> Session:
    session = Session()
    retries = Retry(
        total=total_retries,
        backoff_factor=backoff,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"]
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

session = criar_session_com_retries()

async def click_element(page, selector: str, timeout=3000):
    """Tenta clicar forçadamente em um elemento"""
    try:
        elm = page.locator(selector).first
        if await elm.is_visible(timeout=timeout):
            await elm.click(force=True)
            return True
    except PWTimeout:
        pass
    except Exception:
        pass
    return False

async def _login_and_get_cookie(headless: bool = True) -> str:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=headless,
            args=[
                "--start-maximized", 
                "--no-sandbox", 
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled"
            ],
            slow_mo=100 if not headless else 0
        )
        context = await browser.new_context(viewport=None)
        page = await context.new_page()

        try:
            print(f"Acessando portal Onvio como {ONVIO_USER}...", flush=True)
            await page.goto(URL_PORTAL, wait_until="domcontentloaded", timeout=60000)

            try:
                await page.wait_for_load_state("networkidle", timeout=5000)
            except:
                pass

            # --- ETAPA 0: LOOP DE "ENTRAR" INICIAL ---
            user_input = page.locator("input[name='username']")
            btn_entrar_inicial = page.locator("#trauth-continue-signin-btn")

            for i in range(3):
                if await user_input.is_visible():
                    break

                if await btn_entrar_inicial.is_visible():
                    await btn_entrar_inicial.click(force=True)
                    await asyncio.sleep(2)
                else:
                    if await click_element(page, "button:has-text('Entrar')"):
                        await asyncio.sleep(2)

            # --- ETAPA 1: USUÁRIO ---
            print("Verificando formulário de usuário...", flush=True)
            try:
                await user_input.wait_for(state="visible", timeout=10000)
            except:
                pass

            if await user_input.is_visible():
                is_readonly = await user_input.get_attribute("readonly")
                valor_atual = await user_input.input_value()

                if is_readonly or (valor_atual and valor_atual == ONVIO_USER):
                    print("Usuário já preenchido.", flush=True)
                else:
                    print("Digitando usuário...", flush=True)
                    await user_input.fill(ONVIO_USER)

                if not await click_element(page, "button[type='submit']"):
                    await click_element(page, "#trauth-continue-signin-btn")
            else:
                print("Aviso: Campo de usuário não encontrado (verifique se já está logado).", flush=True)

            # --- ETAPA 2: SENHA ---
            print("Aguardando campo de senha...", flush=True)
            pass_input = page.locator("#password")
            try:
                await pass_input.wait_for(state="visible", timeout=15000) 
                if await pass_input.is_visible():
                    await pass_input.fill(ONVIO_PASS)
                    await page.click("button._button-login-password")
                    print("Senha preenchida e enviada.", flush=True)
            except Exception as e:
                print(f"ERRO: Campo de senha não apareceu. Detalhe: {e}", flush=True)
                if not headless:
                    await page.screenshot(path="debug_senha.png")
                raise e

            await asyncio.sleep(3)

            # --- ETAPA 3: SELEÇÃO DE MÉTODO 2FA ---
            print("Verificando se há seleção de método 2FA...", flush=True)
            seletor_aria = "button[aria-label='Autenticador Google ou similar']"
            seletor_value = "button[value='otp::0']"

            if await page.locator(seletor_aria).first.is_visible(timeout=5000):
                print("Botão 'Autenticador Google' detectado (via aria-label). Clicando...", flush=True)
                await page.locator(seletor_aria).first.click(force=True)
                await asyncio.sleep(2)
            elif await page.locator(seletor_value).first.is_visible(timeout=2000):
                print("Botão 'Autenticador Google' detectado (via value). Clicando...", flush=True)
                await page.locator(seletor_value).first.click(force=True)
                await asyncio.sleep(2)
            elif await page.locator("text=Autenticador Google").count() > 0:
                print("Clicando no texto 'Autenticador Google' (fallback)...", flush=True)
                await page.click("text=Autenticador Google", force=True)
                await asyncio.sleep(2)

            # --- ETAPA 4: INSERÇÃO DO CÓDIGO ---
            if (
                    await page.locator("text=código").count() > 0 or
                    await page.locator("input[type='tel']").count() > 0 or
                    await page.locator("text=verificação").count() > 0
            ):
                print("Tela de digitação do código detectada.", flush=True)

                if not ONVIO_2FA_SECRET:
                    raise RuntimeError("2FA solicitado, mas ONVIO_2FA_SECRET não está configurado.")

                totp = pyotp.TOTP(ONVIO_2FA_SECRET)
                codigo = totp.now()
                print(f"Gerando token 2FA: {codigo}", flush=True)

                try:
                    campo_code = page.locator("input[type='tel'], input[name='code'], input.input-code").first
                    if await campo_code.is_visible():
                        await campo_code.fill(codigo)
                        await click_element(page, "button[type='submit']")
                        await click_element(page, "button:has-text('Verificar')")
                        await asyncio.sleep(3)
                except Exception as e:
                    print(f"Erro ao preencher 2FA: {e}", flush=True)

            # --- ETAPA 5: CAPTURA DO TOKEN ---
            print("Aguardando autenticação final (UDSLongToken)...", flush=True)
            start_wait = time.time()
            while time.time() - start_wait < 60:
                cookies = await context.cookies()
                token = next((c["value"] for c in cookies if c["name"] == "UDSLongToken"), None)
                if token:
                    print("Token capturado com sucesso!", flush=True)
                    return token
                await asyncio.sleep(1)

            raise RuntimeError("Tempo esgotado: O Login não finalizou (Token não encontrado).")

        except Exception as e:
            print(f"[ERRO CRÍTICO NO LOGIN]: {e}", flush=True)
            if not headless:
                print(">>> MANTENDO NAVEGADOR ABERTO POR 20 SEGUNDOS PARA DEBUG VISUAL <<<", flush=True)
                await asyncio.sleep(20)
            raise e
        finally:
            await browser.close()

def get_udslongtoken(force: bool = False) -> str:
    if not force and Path(CACHE_TOK).exists():
        try:
            content = Path(CACHE_TOK).read_text(encoding='utf-8').strip()
            if "|" in content:
                valor, ts = content.split("|")
                if time.time() - float(ts) < TOKEN_TTL:
                    return valor
        except:
            pass

    last_exc = None
    for attempt in range(1, MAX_LOGIN_ATTEMPTS + 1):
        try:
            print(f"Tentativa de login {attempt}/{MAX_LOGIN_ATTEMPTS}...", flush=True)
            # Roda Headless por padrão. (Mude para False se precisar ver o Chrome abrindo de novo)
            token = asyncio.run(_login_and_get_cookie(headless=True)) 
            Path(CACHE_TOK).write_text(f"{token}|{time.time()}", encoding='utf-8')
            return token
        except Exception as e:
            print(f"Falha na tentativa {attempt}: {e}", flush=True)
            last_exc = e
            time.sleep(BACKOFF_BASE * attempt)

    raise RuntimeError(f"Falha fatal após {MAX_LOGIN_ATTEMPTS} tentativas: {last_exc}")

# ==============================================================================
# FUNÇÕES DE LISTAGEM (API REQUESTS)
# ==============================================================================
def request_onvio(params):
    """Envolve a requisição com tratamento de token expirado"""
    token = get_udslongtoken()
    if not token: raise RuntimeError("Sem token.")

    headers = {"Authorization": f"UDSLongToken {token}", "Accept": "application/json"}

    try:
        r = session.get(URL_API, headers=headers, params=params, timeout=READ_TIMEOUT)
    except Exception as e:
        print(f"Erro de Conexão: {e}", flush=True)
        raise

    if r.status_code == 401:
        print("Token expirado (401). Renovando...", flush=True)
        token = get_udslongtoken(force=True)
        headers["Authorization"] = f"UDSLongToken {token}"
        r = session.get(URL_API, headers=headers, params=params, timeout=READ_TIMEOUT)

    if r.status_code != 200:
        print(f"Erro API Onvio: {r.status_code} | {r.text}", flush=True)

    r.raise_for_status()
    return r.json()


def listar_nomes_com_data(created_date: str) -> dict[str, str]:
    nomes: dict[str, str] = {}
    pagina = 1

    print(f"Iniciando varredura no Onvio. Período: {created_date}", flush=True)

    while True:
        items = []
        sucesso = False
        
        # Loop de segurança da requisição (Tenta até 3x ler a mesma página)
        for t in range(3):
            try:
                params = {**BASE_PARAMS, "createdDate": created_date, "from": str(pagina)}
                data = request_onvio(params)
                items = data.get("data", {}).get("items", [])
                sucesso = True
                break
            except Exception as e:
                print(f"Falha ao carregar página {pagina} (Tentativa {t + 1}): {e}", flush=True)
                time.sleep(2)

        if not sucesso:
            raise RuntimeError(f"Erro crítico ao acessar a página {pagina} do Onvio.")

        if not items:
            print("Fim da listagem de arquivos alcançado.", flush=True)
            break

        for it in items:
            name = it["name"]
            ts = it.get("createdDate") or it.get("lastModified")
            if name and ts and (name not in nomes or ts > nomes[name]):
                nomes[name] = ts

        print(f"Página {pagina} lida: {len(items)} arquivos. Total acumulado: {len(nomes)}", flush=True)
        pagina += 1

    return nomes