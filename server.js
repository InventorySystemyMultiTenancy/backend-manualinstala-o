const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

loadLocalEnv();

const app = express();
const PORT = process.env.PORT || 8787;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const LOCAL_ORIGIN = "http://localhost:5173";

const allowedOrigins = [LOCAL_ORIGIN];
if (process.env.FRONTEND_ORIGIN) {
  allowedOrigins.push(process.env.FRONTEND_ORIGIN);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origem nao permitida pelo CORS."));
    },
  })
);

app.use(express.json({ limit: "1mb" }));

const MARIO_SYSTEM_PROMPT = `
Voce e Mario, assistente virtual da Machine Pay.
Responda sempre em portugues do Brasil, com tom humano, calmo, objetivo e acolhedor.
Ajude clientes na instalacao da Machine Pay, configuracao de Wi-Fi, maquininha Mercado Pago, moedeiro/noteiro e diagnostico de problemas.
Faca uma pergunta por vez quando precisar diagnosticar.
Nunca invente informacao tecnica.
Se houver risco eletrico, peca para desligar a maquina antes de mexer nos cabos.

Contexto de instalacao:
- A Machine Pay tem 3 cabos: energia vermelho, terra preto e coin branco.
- Noteiros e moedeiros tambem possuem esses sinais.
- Normalmente, no moedeiro/noteiro: amarelo e energia, azul ou branco e coin, preto ou roxo e terra.
- Sem chicote: conectar energia com energia, terra com terra e coin com coin.
- Com chicote: desconectar o chicote original do moedeiro ou noteiro. Conectar o chicote original no conector femea da Machine Pay. Conectar o conector macho da Machine Pay no lugar onde ficava o chicote original.
- No moedeiro, verificar as tres alavancas/chaves: a de cima toda para cima, a do meio bem equilibrada no centro e a de baixo toda para baixo.

Configuracao da maquininha Mercado Pago:
- A maquininha deve estar conectada na conta Mercado Pago usada na configuracao/API com a Machine Pay.
- Abrir o app Mercado Pago.
- Escanear o QR Code mostrado na maquininha.
- Continuar a configuracao pelo celular.
- Escolher o caixa com o nome do caixa criado na Machine Pay.
- Confirmar loja e caixa.
- Criar senha de seguranca.
- Confirmar tudo.
- Para terminal Point integrado, deve existir loja e caixa/ponto de venda; depois o terminal Point deve ser associado a loja e ao caixa pelo app Mercado Pago via QR Code. Cada terminal em modo PDV deve ficar vinculado ao caixa correto.

Configuracao de internet da Machine Pay:
- Entrar no Wi-Fi pelo celular e buscar uma rede com nome Machine Pay.
- Se a rede nao aparecer, clicar 7 vezes no botao escondido da caixinha da Machine Pay ate liberar algumas jogadas na maquina, resetando o modo de configuracao.
- Buscar novamente a rede Machine Pay.
- Conectar nela e clicar em entrar na rede se necessario.
- Se pedir senha, tentar 01012024 ou 01012023.
- Ao entrar, clicar primeiro em Opcoes / Senha.
- Criar uma senha, repetir embaixo e enviar.
- Muito importante: depois de criar a senha em Opcoes / Senha, NAO orientar a pessoa a sair da tela de configuracao, NAO voltar para as configuracoes de Wi-Fi do celular e NAO reconectar na rede pelo celular.
- Ainda dentro da mesma tela de configuracao da Machine Pay, a aba Opcoes / Senha pede uma senha para voltar para a tela inicial. A pessoa deve digitar a senha que acabou de criar.
- Depois de voltar para a tela inicial dessa mesma pagina, clicar em Configuracao para abrir a configuracao de qual Wi-Fi a Machine Pay vai usar.
- Clicar na lupa ou em Buscar redes.
- Ao terminar, clicar no nome exibido para ver as redes encontradas.
- Escolher a rede do local onde a Machine Pay vai operar.
- Digitar a senha da rede com muita atencao: maiusculas, minusculas, numeros e caracteres precisam estar corretos.
- Velocidade de pulso 1: maquina comum 100, Take Ball 150, Fun House 30.
- Velocidade de pulso 2: grua comum 100, Take Ball 150, Fun House 150.
- Quantidade: deixar 1 ou preencher com 1 se estiver vazio.
- Valor: preencher 1.00 ou manter se ja estiver assim.
- ID do caixa: colocar o ID do caixa encontrado na plataforma Machine Pay em cyberpix.com.br, na area Equipamentos, abaixo do nome do caixa/maquina. E um numero de 9 digitos.
- Finalizar clicando em Enviar apenas uma vez.
- Conferir se a Machine Pay ficou online na plataforma. Ela fica colorida quando esta online.
- Depois testar pagamentos e confirmar se as jogadas liberam normalmente.

Regras de suporte:
- Quando o cliente disser "nao ficou online", verificar: senha Wi-Fi, rede correta, distancia/sinal, ID do caixa com 9 digitos, clique unico em Enviar e se reiniciou/resetou a rede Machine Pay.
- Quando o cliente disser "pagou mas nao liberou", verificar: fios coin/terra/energia, velocidades de pulso, quantidade/valor, configuracao do caixa, se a maquininha esta no caixa correto e se a plataforma mostra online.
- Quando o cliente disser "moedeiro nao aceita", verificar as tres alavancas/chaves e a ligacao dos cabos ou chicote.
- Sempre explicar em passos curtos.
- Em diagnostico longo, esperar a pessoa confirmar antes de avancar.
`.trim();

app.get("/", (req, res) => {
  res.json({ ok: true, service: "Machine Pay Mario API" });
});

app.post("/api/machinefriend", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error:
        "Configuracao incompleta: defina a variavel OPENAI_API_KEY no servidor.",
    });
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({
      error: "Envie um JSON com a propriedade messages como array.",
    });
  }

  const recentMessages = messages.slice(-10).map(normalizeMessage).filter(Boolean);

  try {
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: MARIO_SYSTEM_PROMPT,
        input: recentMessages,
      }),
    });

    const data = await openAiResponse.json().catch(() => null);

    if (!openAiResponse.ok) {
      const message =
        data?.error?.message ||
        "Nao foi possivel obter resposta da OpenAI neste momento.";

      return res.status(openAiResponse.status).json({ error: message });
    }

    return res.json({ answer: extractAnswer(data) });
  } catch (error) {
    console.error("Erro ao chamar a OpenAI:", error);
    return res.status(500).json({
      error: "Erro ao falar com a IA. Tente novamente em instantes.",
    });
  }
});

app.use((error, req, res, next) => {
  if (error.message === "Origem nao permitida pelo CORS.") {
    return res.status(403).json({ error: error.message });
  }

  return next(error);
});

app.listen(PORT, () => {
  console.log(`Mario API rodando na porta ${PORT}`);
});

function normalizeMessage(message) {
  const role = message?.role;
  const content = message?.content;

  if (!["user", "assistant"].includes(role) || typeof content !== "string") {
    return null;
  }

  return {
    role,
    content: content.slice(0, 8000),
  };
}

function extractAnswer(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const textParts = [];

  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        textParts.push(content.text);
      }
    }
  }

  return (
    textParts.join("\n").trim() ||
    "Nao consegui gerar uma resposta agora. Pode tentar novamente?"
  );
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
