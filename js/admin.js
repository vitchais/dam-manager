// ================================
// DAM MANAGER - ADMIN
// Parte 1
// ================================

let reservas = [];
let reservasFiltradas = [];
let reservaSelecionada = null;

const tabela = document.getElementById("tabelaReservas");
const pesquisa = document.getElementById("pesquisa");

async function carregarReservas() {

    const { data, error } = await supabaseClient
        .from("reservas")
        .select(`
            *,
            clientes!reservas_cliente_id_fkey(
                nome,
                telefone
            )
        `)
        .order("data_reserva", { ascending: true })
        .order("horario", { ascending: true });

    if (error) {
        console.error(error);
        alert("Erro ao carregar reservas.");
        return;
    }

    reservas = data || [];
    reservasFiltradas = [...reservas];

    atualizarDashboard();
    renderizarTabela();

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

            <td>${reserva.clientes?.nome ?? "-"}</td>

            <td>${reserva.clientes?.telefone ?? "-"}</td>

            <td>${formatarData(reserva.data_reserva)}</td>

            <td>${reserva.horario}</td>

            <td>${reserva.pessoas}</td>

            <td>${reserva.ambiente_pref ?? "-"}</td>

            <td>

                <span class="${classeStatus(reserva.status)}">

                    ${reserva.status}

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
        reservaSelecionada.horario ?? "-";

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

    const { error } = await supabaseClient
        .from("reservas")
        .update({
            status: status
        })
        .eq("id", reservaSelecionada.id);

    if(error){

        console.error(error);
        alert("Erro ao atualizar.");

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

    const { error } = await supabaseClient
        .from("reservas")
        .delete()
        .eq("id", reservaSelecionada.id);

    if(error){

        console.error(error);

        alert("Erro ao excluir.");

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

carregarReservas();