// ================================
// DAM MANAGER - ADMIN
// Parte 1
// ================================

let reservas = [];
let reservasFiltradas = [];
let reservaSelecionada = null;

const tabela = document.getElementById("tabelaReservas");
const pesquisa = document.getElementById("pesquisa");

// ================================
// Acesso ao servidor
//
// O painel não fala mais direto com o Supabase. Ele chama a API deste
// servidor, que exige senha e guarda a chave do banco do lado de lá.
// A senha fica na sessão da aba e some quando ela é fechada.
// ================================

const CHAVE_SESSAO = "dam_admin_senha";

async function api(caminho, opcoes) {

    opcoes = opcoes || {};

    const resposta = await fetch("/api" + caminho, {
        method: opcoes.method || "GET",
        headers: {
            "Content-Type": "application/json",
            "x-admin-password": sessionStorage.getItem(CHAVE_SESSAO) || ""
        },
        body: opcoes.body
    });

    if (resposta.status === 401) {
        sessionStorage.removeItem(CHAVE_SESSAO);
        mostrarLogin("Sessão expirada. Entre novamente.");
        throw new Error("nao-autenticado");
    }

    const dados = await resposta.json().catch(()=>({}));

    if (!resposta.ok) {
        throw new Error(dados.erro || ("Erro " + resposta.status));
    }

    return dados;

}

/* Escapa o que veio do banco antes de jogar no HTML. O nome do cliente vem
   do perfil do WhatsApp, ou seja, é texto que um estranho escolhe. */
function esc(valor){

    if(valor === null || valor === undefined) return "-";

    return String(valor)
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#39;");

}

async function carregarReservas() {

    try {

        const dados = await api("/reservas");

        reservas = dados.reservas || [];
        reservasFiltradas = [...reservas];

        atualizarDashboard();
        renderizarTabela();

    } catch (erro) {

        if (erro.message === "nao-autenticado") return;

        console.error(erro);
        alert("Erro ao carregar reservas: " + erro.message);

    }

}

function renderizarTabela() {

    tabela.innerHTML = "";

    if(reservasFiltradas.length === 0){

        tabela.innerHTML = `
            <tr>
                <td colspan="8">
                    Nenhuma reserva encontrada.
                </td>
            </tr>
        `;

        return;

    }

    reservasFiltradas.forEach(reserva=>{

        tabela.innerHTML += `

        <tr>

            <td>${esc(reserva.clientes?.nome)}</td>

            <td>${esc(reserva.clientes?.telefone)}</td>

            <td>${formatarData(reserva.data_reserva)}</td>

            <td>${formatarHorario(reserva.horario)}</td>

            <td>${esc(reserva.pessoas)}</td>

            <td>${esc(reserva.ambiente_pref)}</td>

            <td>

                <span class="${classeStatus(reserva.status)}">

                    ${esc(reserva.status)}

                </span>

            </td>

            <td>

                <button class="ver"
                    onclick="abrirModal('${reserva.id}')">

                    Ver

                </button>

            </td>

        </tr>

        `;

    });

}

function atualizarDashboard(){

    const hoje = new Date().toISOString().split("T")[0];

    document.getElementById("hoje").textContent =
        reservas.filter(r=>r.data_reserva===hoje).length;

    document.getElementById("pendentes").textContent =
        reservas.filter(r=>r.status==="Pendente").length;

    document.getElementById("confirmadas").textContent =
        reservas.filter(r=>r.status==="Confirmada").length;

    document.getElementById("canceladas").textContent =
        reservas.filter(r=>r.status==="Cancelada").length;

}

function classeStatus(status){

    if(status==="Confirmada") return "status-confirmada";

    if(status==="Cancelada") return "status-cancelada";

    return "status-pendente";

}

function formatarData(data){

    if(!data) return "-";

    return data.split("-").reverse().join("/");

}

/* O Postgres devolve "20:00:00"; no painel basta "20:00". */
function formatarHorario(horario){

    if(!horario) return "-";

    return String(horario).slice(0,5);

}

pesquisa.addEventListener("input",()=>{

    const texto = pesquisa.value.toLowerCase();

    reservasFiltradas = reservas.filter(r=>{

        const nome =
            r.clientes?.nome?.toLowerCase() ?? "";

        const telefone =
            r.clientes?.telefone ?? "";

        return nome.includes(texto)
            || telefone.includes(texto);

    });

    renderizarTabela();

});

// ================================
// DAM MANAGER - ADMIN
// Parte 2
// ================================

window.abrirModal = function(id){

    reservaSelecionada =
        reservas.find(r=>String(r.id)===String(id));

    if(!reservaSelecionada) return;

    document.getElementById("mNome").textContent =
        reservaSelecionada.clientes?.nome ?? "-";

    document.getElementById("mTelefone").textContent =
        reservaSelecionada.clientes?.telefone ?? "-";

    document.getElementById("mData").textContent =
        formatarData(reservaSelecionada.data_reserva);

    document.getElementById("mHorario").textContent =
        formatarHorario(reservaSelecionada.horario);

    document.getElementById("mPessoas").textContent =
        reservaSelecionada.pessoas ?? "-";

    document.getElementById("mAmbiente").textContent =
        reservaSelecionada.ambiente_pref ?? "-";

    document.getElementById("mObs").textContent =
        reservaSelecionada.observacoes ?? "-";

    document.getElementById("mStatus").textContent =
        reservaSelecionada.status ?? "-";

    document.getElementById("modalReserva").style.display = "flex";

}

window.fecharModal = function(){

    document.getElementById("modalReserva").style.display = "none";

}

async function atualizarStatus(status){

    if(!reservaSelecionada) return;

    try {

        await api("/reservas/" + reservaSelecionada.id + "/status", {
            method: "PATCH",
            body: JSON.stringify({ status: status })
        });

    } catch (erro) {

        if (erro.message === "nao-autenticado") return;

        console.error(erro);
        alert("Erro ao atualizar: " + erro.message);

        return;

    }

    fecharModal();

    await carregarReservas();

}

document
.getElementById("btnConfirmar")
.addEventListener("click",()=>{

    atualizarStatus("Confirmada");

});

document
.getElementById("btnCancelar")
.addEventListener("click",()=>{

    atualizarStatus("Cancelada");

});

async function excluirReserva(){

    if(!reservaSelecionada) return;

    const confirmar = confirm(
        "Deseja realmente excluir esta reserva?"
    );

    if(!confirmar) return;

    try {

        await api("/reservas/" + reservaSelecionada.id, {
            method: "DELETE"
        });

    } catch (erro) {

        if (erro.message === "nao-autenticado") return;

        console.error(erro);

        alert("Erro ao excluir: " + erro.message);

        return;

    }

    fecharModal();

    await carregarReservas();

}

const botaoExcluir = document.createElement("button");

botaoExcluir.textContent = "Excluir";

botaoExcluir.style.background = "#c62828";

botaoExcluir.onclick = excluirReserva;

document
.querySelector(".modal-content")
.appendChild(botaoExcluir);

// ================================
// DAM MANAGER - ADMIN
// Parte 3 — senha
// ================================

function mostrarLogin(mensagem){

    document.getElementById("telaLogin").style.display = "flex";
    document.getElementById("painel").style.display = "none";
    document.getElementById("erroLogin").textContent = mensagem || "";

}

function mostrarPainel(){

    document.getElementById("telaLogin").style.display = "none";
    document.getElementById("painel").style.display = "block";

}

async function entrar(){

    const campo = document.getElementById("campoSenha");

    if(!campo.value){
        document.getElementById("erroLogin").textContent = "Digite a senha.";
        return;
    }

    sessionStorage.setItem(CHAVE_SESSAO, campo.value);

    try {

        await api("/login", { method: "POST" });

        campo.value = "";
        mostrarPainel();
        await carregarReservas();

    } catch (erro) {

        sessionStorage.removeItem(CHAVE_SESSAO);

        document.getElementById("erroLogin").textContent =
            erro.message === "nao-autenticado" ? "Senha inválida." : erro.message;

    }

}

document
.getElementById("btnEntrar")
.addEventListener("click", entrar);

document
.getElementById("campoSenha")
.addEventListener("keydown", (evento)=>{

    if(evento.key === "Enter") entrar();

});

// Se a aba já tem senha guardada, entra direto.
if(sessionStorage.getItem(CHAVE_SESSAO)){

    api("/login", { method: "POST" })
        .then(()=>{
            mostrarPainel();
            return carregarReservas();
        })
        .catch(()=>mostrarLogin());

} else {

    mostrarLogin();

}