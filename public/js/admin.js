// ============================================================================
// public/js/admin.js — Painel administrativo do DAM
//
// Este arquivo NÃO fala com o Supabase. Ele fala com a API deste servidor
// (/api/*), que exige senha e usa a chave secreta do banco do lado de cá.
// Antes, o painel usava a chave pública do Supabase direto no navegador, o que
// deixava a lista de clientes (nome + telefone) acessível a qualquer visitante.
//
// A senha fica em sessionStorage: some quando a aba é fechada.
// ============================================================================

const CHAVE_SESSAO = 'dam_admin_senha';

let reservas = [];
let reservasFiltradas = [];
let reservaSelecionada = null;

const tabela = document.getElementById('tabelaReservas');
const pesquisa = document.getElementById('pesquisa');
const telaLogin = document.getElementById('telaLogin');
const painel = document.getElementById('painel');
const campoSenha = document.getElementById('campoSenha');
const erroLogin = document.getElementById('erroLogin');

function senhaSalva() {
  return sessionStorage.getItem(CHAVE_SESSAO) ?? '';
}

/** Wrapper de fetch que injeta a senha e trata 401 devolvendo ao login. */
async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': senhaSalva(),
      ...(opcoes.headers ?? {}),
    },
  });

  if (resposta.status === 401) {
    sessionStorage.removeItem(CHAVE_SESSAO);
    mostrarLogin('Sessão expirada. Entre novamente.');
    throw new Error('não autenticado');
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(dados.erro ?? `Erro ${resposta.status}`);
  }

  return dados;
}

// ----------------------------------------------------------------------------
// Login
// ----------------------------------------------------------------------------

function mostrarLogin(mensagem = '') {
  telaLogin.style.display = 'flex';
  painel.style.display = 'none';
  erroLogin.textContent = mensagem;
}

function mostrarPainel() {
  telaLogin.style.display = 'none';
  painel.style.display = 'block';
}

async function entrar() {
  const senha = campoSenha.value;
  if (!senha) {
    erroLogin.textContent = 'Digite a senha.';
    return;
  }

  sessionStorage.setItem(CHAVE_SESSAO, senha);

  try {
    await api('/login', { method: 'POST' });
    campoSenha.value = '';
    erroLogin.textContent = '';
    mostrarPainel();
    await carregarReservas();
  } catch (erro) {
    sessionStorage.removeItem(CHAVE_SESSAO);
    erroLogin.textContent =
      erro.message === 'não autenticado' ? 'Senha inválida.' : erro.message;
  }
}

function sair() {
  sessionStorage.removeItem(CHAVE_SESSAO);
  mostrarLogin();
}

// ----------------------------------------------------------------------------
// Reservas
// ----------------------------------------------------------------------------

async function carregarReservas() {
  try {
    const { reservas: lista } = await api('/reservas');
    reservas = lista ?? [];
    reservasFiltradas = [...reservas];
    atualizarDashboard();
    renderizarTabela();
  } catch (erro) {
    if (erro.message === 'não autenticado') return;
    console.error(erro);
    alert(`Erro ao carregar reservas: ${erro.message}`);
  }
}

/** Escapa texto vindo do banco antes de injetar no HTML. */
function esc(valor) {
  if (valor === null || valor === undefined) return '-';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderizarTabela() {
  tabela.innerHTML = '';

  if (reservasFiltradas.length === 0) {
    tabela.innerHTML = '<tr><td colspan="8">Nenhuma reserva encontrada.</td></tr>';
    return;
  }

  // Monta tudo de uma vez: concatenar innerHTML dentro do laço reprocessa a
  // tabela inteira a cada linha.
  tabela.innerHTML = reservasFiltradas
    .map(
      (reserva) => `
        <tr>
          <td>${esc(reserva.clientes?.nome)}</td>
          <td>${esc(reserva.clientes?.telefone)}</td>
          <td>${formatarData(reserva.data_reserva)}</td>
          <td>${esc(formatarHorario(reserva.horario))}</td>
          <td>${esc(reserva.pessoas)}</td>
          <td>${esc(reserva.ambiente_pref)}</td>
          <td><span class="${classeStatus(reserva.status)}">${esc(reserva.status)}</span></td>
          <td><button class="ver" data-id="${esc(reserva.id)}">Ver</button></td>
        </tr>`,
    )
    .join('');
}

// Delegação de evento: sobrevive à tabela ser redesenhada.
tabela.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button.ver');
  if (botao) abrirModal(botao.dataset.id);
});

function atualizarDashboard() {
  const hoje = new Date().toLocaleDateString('en-CA');

  const contar = (predicado) => reservas.filter(predicado).length;

  document.getElementById('hoje').textContent = contar((r) => r.data_reserva === hoje);
  document.getElementById('pendentes').textContent = contar((r) => r.status === 'Pendente');
  document.getElementById('confirmadas').textContent = contar((r) => r.status === 'Confirmada');
  document.getElementById('canceladas').textContent = contar((r) => r.status === 'Cancelada');
}

function classeStatus(status) {
  if (status === 'Confirmada') return 'status-confirmada';
  if (status === 'Cancelada') return 'status-cancelada';
  return 'status-pendente';
}

function formatarData(data) {
  if (!data) return '-';
  return data.split('-').reverse().join('/');
}

/** O Postgres devolve "20:00:00"; no painel basta "20:00". */
function formatarHorario(horario) {
  if (!horario) return '-';
  return String(horario).slice(0, 5);
}

pesquisa.addEventListener('input', () => {
  const texto = pesquisa.value.toLowerCase();

  reservasFiltradas = reservas.filter((reserva) => {
    const nome = reserva.clientes?.nome?.toLowerCase() ?? '';
    const telefone = reserva.clientes?.telefone ?? '';
    return nome.includes(texto) || telefone.includes(texto);
  });

  renderizarTabela();
});

// ----------------------------------------------------------------------------
// Modal
// ----------------------------------------------------------------------------

function abrirModal(id) {
  reservaSelecionada = reservas.find((reserva) => String(reserva.id) === String(id));
  if (!reservaSelecionada) return;

  const preencher = (elemento, valor) => {
    document.getElementById(elemento).textContent = valor ?? '-';
  };

  preencher('mNome', reservaSelecionada.clientes?.nome);
  preencher('mTelefone', reservaSelecionada.clientes?.telefone);
  preencher('mData', formatarData(reservaSelecionada.data_reserva));
  preencher('mHorario', formatarHorario(reservaSelecionada.horario));
  preencher('mPessoas', reservaSelecionada.pessoas);
  preencher('mAmbiente', reservaSelecionada.ambiente_pref);
  preencher('mObs', reservaSelecionada.observacoes);
  preencher('mStatus', reservaSelecionada.status);
  preencher('mOrigem', reservaSelecionada.origem);

  document.getElementById('modalReserva').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('modalReserva').style.display = 'none';
  reservaSelecionada = null;
}

async function mudarStatus(status) {
  if (!reservaSelecionada) return;

  try {
    await api(`/reservas/${reservaSelecionada.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    fecharModal();
    await carregarReservas();
  } catch (erro) {
    if (erro.message === 'não autenticado') return;
    alert(`Erro ao atualizar: ${erro.message}`);
  }
}

async function excluirReserva() {
  if (!reservaSelecionada) return;
  if (!confirm('Deseja realmente excluir esta reserva?')) return;

  try {
    await api(`/reservas/${reservaSelecionada.id}`, { method: 'DELETE' });
    fecharModal();
    await carregarReservas();
  } catch (erro) {
    if (erro.message === 'não autenticado') return;
    alert(`Erro ao excluir: ${erro.message}`);
  }
}

// ----------------------------------------------------------------------------
// Ligações de interface
// ----------------------------------------------------------------------------

document.getElementById('btnEntrar').addEventListener('click', entrar);
campoSenha.addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') entrar();
});
document.getElementById('btnSair').addEventListener('click', sair);
document.getElementById('btnAtualizar').addEventListener('click', carregarReservas);
document.getElementById('btnConfirmar').addEventListener('click', () => mudarStatus('Confirmada'));
document.getElementById('btnCancelar').addEventListener('click', () => mudarStatus('Cancelada'));
document.getElementById('btnExcluir').addEventListener('click', excluirReserva);
document.getElementById('btnFechar').addEventListener('click', fecharModal);

// Já tem senha guardada nesta aba? Entra direto.
if (senhaSalva()) {
  api('/login', { method: 'POST' })
    .then(() => {
      mostrarPainel();
      return carregarReservas();
    })
    .catch(() => mostrarLogin());
} else {
  mostrarLogin();
}
