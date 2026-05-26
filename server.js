import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf8');

  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (!process.env[key]) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}

const PORT = Number(process.env.MACHINEFRIEND_PORT || 8787);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const MACHINEFRIEND_HISTORY_LIMIT = Number(
  process.env.MACHINEFRIEND_HISTORY_LIMIT || 6
);
const MACHINEFRIEND_MAX_OUTPUT_TOKENS = Number(
  process.env.MACHINEFRIEND_MAX_OUTPUT_TOKENS || 1200
);
const MACHINEFRIEND_EMPTY_RETRY_TOKENS = Number(
  process.env.MACHINEFRIEND_EMPTY_RETRY_TOKENS || 1800
);

const MACHINEFRIEND_CONTEXT = `
Voce e o Mario, assistente de suporte da Machine Pay para instalacao, configuracao e diagnostico.
Responda sempre em portugues do Brasil, com tom humano, calmo, objetivo e acolhedor. Faca uma pergunta por vez quando precisar diagnosticar. Nunca invente informacao tecnica. Se houver risco eletrico, peca para desligar a maquina antes de mexer nos cabos.

Contexto principal de instalacao da Machine Pay:
- A Machine Pay tem 3 cabos: energia vermelho, terra preto e coin branco.
- Noteiros e moedeiros tambem possuem esses sinais. Normalmente: amarelo energia, azul ou branco coin, preto ou roxo terra.
- Para instalar sem chicote, conectar os fios coerentemente: energia com energia, terra com terra e coin com coin.
- Se a Machine Pay vier com chicote, desconectar o chicote original do moedeiro ou noteiro. Conectar o chicote original no conector femea da Machine Pay. Conectar o conector macho da Machine Pay no lugar onde ficava o chicote original.
- No moedeiro, verificar as tres alavancas/chaves: a de cima toda para cima, a do meio bem equilibrada no centro e a de baixo toda para baixo.

Configuracao da maquininha Mercado Pago:
- A maquininha deve ser conectada na conta do Mercado Pago usada na configuracao/API com a Machine Pay.
- Abrir o app Mercado Pago, escanear o QR Code mostrado na maquininha e continuar pelo celular.
- Escolher o caixa com o nome do caixa criado na Machine Pay.
- Confirmar loja e caixa, criar senha de seguranca e confirmar tudo.
- Documentacao Mercado Pago Point integrado: para configurar terminal em modo integrado, primeiro deve existir loja e caixa/ponto de venda; depois o terminal Point deve ser associado a loja e caixa criados pelo app Mercado Pago via QR Code. Cada terminal em modo PDV deve ficar vinculado ao caixa correto.

Configuracao de internet da Machine Pay:
- Entrar no Wi-Fi pelo celular e buscar uma rede com nome Machine Pay.
- Se nao encontrar a rede, clicar 7 vezes no botao escondido da caixinha da Machine Pay ate liberar algumas jogadas na maquina, resetando o modo de configuracao.
- Buscar novamente a rede Machine Pay, conectar nela e clicar em entrar na rede se necessario.
- Se pedir senha, tentar 01012024 ou 01012023.
- Ao entrar, clicar primeiro em Opcoes / Senha, criar uma senha, repetir embaixo e enviar.
- Muito importante: depois de criar a senha em Opcoes / Senha, NAO orientar a pessoa a sair da tela de configuracao, NAO voltar para as configuracoes de Wi-Fi do celular e NAO reconectar na rede pelo celular.
- Ainda dentro da mesma tela de configuracao da Machine Pay, a aba Opcoes / Senha pede uma senha para voltar para a tela inicial. A pessoa deve digitar a senha que acabou de criar.
- Depois de voltar para a tela inicial dessa mesma pagina, clicar em Configuracao para abrir a configuracao de qual Wi-Fi a Machine Pay vai usar.
- Clicar na lupa ou em Buscar redes. Ao terminar, clicar no nome exibido para ver as redes encontradas.
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

Regras de resposta:
- Responda curto, direto e em passos pequenos, especialmente quando a conversa for por voz.
- Normalmente use ate 4 frases. So detalhe mais quando o cliente pedir.
- Priorize a proxima acao pratica antes de explicar o motivo.

Regras de suporte:
- Quando o cliente disser "nao ficou online", verificar: senha Wi-Fi, rede correta, distancia/sinal, ID do caixa com 9 digitos, clique unico em Enviar e se reiniciou/resetou a rede Machine Pay.
- Quando o cliente disser "pagou mas nao liberou", verificar: fios coin/terra/energia, velocidades de pulso, quantidade/valor, configuracao do caixa, se a maquininha esta no caixa correto e se a plataforma mostra online.
- Quando o cliente disser "moedeiro nao aceita", verificar as tres alavancas/chaves e a ligacao dos cabos ou chicote.
- Sempre explique em passos curtos e espere a pessoa confirmar antes de avancar se for um diagnostico longo.
`;

const json = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.MACHINEFRIEND_ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25_000) {
        request.destroy();
        reject(new Error('Mensagem muito grande.'));
      }
    });

    request.on('end', () => resolve(body));
    request.on('error', reject);
  });

const getOutputText = (data) => {
  if (data.output_text) return data.output_text;

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => ['output_text', 'text'].includes(content.type))
    .map((content) => {
      if (typeof content.text === 'string') return content.text;
      if (typeof content.text?.value === 'string') return content.text.value;
      return '';
    })
    .join('\n')
    .trim();
};

const getLastUserMessage = (messages) =>
  [...messages]
    .reverse()
    .find((message) => message.role === 'user')?.content || '';

const createLocalFallbackAnswer = (messages) => {
  const lastMessage = String(getLastUserMessage(messages)).toLowerCase();

  if (lastMessage.includes('online') || lastMessage.includes('internet')) {
    return 'Vamos deixar online. Primeiro entre no Wi-Fi do celular e conecte na rede Machine Pay. Se ela nao aparecer, clique 7 vezes no botao escondido da caixinha para resetar a configuracao e procure a rede de novo. Quando abrir a tela da Machine Pay, va em Opcoes / Senha, crie uma senha e envie. Me avise quando essa tela pedir a senha para voltar ao inicio.';
  }

  if (
    lastMessage.includes('sem chicote') &&
    (lastMessage.includes('noteiro') || lastMessage.includes('nota'))
  ) {
    return 'Claro. Primeiro desligue a maquina da tomada antes de mexer nos fios. Sem chicote, ligue vermelho da Machine Pay no positivo/energia do noteiro, preto no terra/negativo e branco no fio coin/pulso do noteiro. No noteiro geralmente energia e amarelo, coin e azul ou branco, e terra e preto ou roxo. Me diga quais cores aparecem no seu noteiro para eu confirmar com voce.';
  }

  return 'Certo, vamos por partes. Primeiro me diga se voce esta na tela de configuracao da Machine Pay, na plataforma cyberpix.com.br, ou mexendo nos fios da maquina.';
};

const normalizeMessages = (messages) =>
  messages
    .filter((message) => ['user', 'assistant'].includes(message.role))
    .slice(-MACHINEFRIEND_HISTORY_LIMIT)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 2_000),
    }));

const requestMachineFriendAnswer = async (messages, maxOutputTokens) => {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: MACHINEFRIEND_CONTEXT,
      input: normalizeMessages(messages),
      max_output_tokens: maxOutputTokens,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data.error?.message || 'Erro ao chamar a OpenAI.';
    throw new Error(message);
  }

  return getOutputText(data);
};

const createMachineFriendAnswer = async (messages) => {
  const answer = await requestMachineFriendAnswer(
    messages,
    MACHINEFRIEND_MAX_OUTPUT_TOKENS
  );

  if (answer) return answer;

  const retryAnswer = await requestMachineFriendAnswer(
    messages,
    MACHINEFRIEND_EMPTY_RETRY_TOKENS
  );

  return retryAnswer || createLocalFallbackAnswer(messages);
};

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    return json(response, 200, { ok: true });
  }

  if (request.url !== '/api/machinefriend' || request.method !== 'POST') {
    return json(response, 404, { error: 'Rota nao encontrada.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return json(response, 500, { error: 'Configure OPENAI_API_KEY no ambiente do servidor.' });
  }

  try {
    const rawBody = await readBody(request);
    const body = JSON.parse(rawBody || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!messages.length) {
      return json(response, 400, { error: 'Envie pelo menos uma mensagem.' });
    }

    const answer = await createMachineFriendAnswer(messages);
    return json(response, 200, { answer });
  } catch (error) {
    return json(response, 500, { error: error.message || 'Erro inesperado.' });
  }
});

server.listen(PORT, () => {
  console.log(`Mario API rodando em http://localhost:${PORT}/api/machinefriend`);
});
