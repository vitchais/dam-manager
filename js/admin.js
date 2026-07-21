let reservas = [];

async function carregarReservas() {

    const { data, error } = await supabaseClient
        .from("reservas")
        .select(`
            *,
            clientes!reservas_cliente_id_fkey (
                nome,
                telefone
            )
        `)
        .order("data_reserva", { ascending: true });

    if (error) {
        console.error(error);
        alert("Erro ao carregar reservas.");
        return;
    }

    reservas = data || [];

    const tabela = document.getElementById("tabelaReservas");

    tabela.innerHTML = "";

    let hoje = 0;
    let pendentes = 0;
    let confirmadas = 0;
    let canceladas = 0;

    reservas.forEach(reserva => {

        if (reserva.status === "Pendente") pendentes++;
        if (reserva.status === "Confirmada") confirmadas++;
        if (reserva.status === "Cancelada") canceladas++;

        tabela.innerHTML += `
            <tr>

                <td>${reserva.clientes?.nome ?? "-"}</td>

                <td>${reserva.clientes?.telefone ?? "-"}</td>

                <td>${reserva.data_reserva ?? "-"}</td>

                <td>${reserva.horario ?? "-"}</td>

                <td>${reserva.pessoas ?? "-"}</td>

                <td>${reserva.ambiente_pref ?? "-"}</td>

                <td>${reserva.status ?? "-"}</td>

                <td>
                    <button class="ver" onclick="abrirModal('${reserva.id}')">
                        Ver
                    </button>
                </td>

            </tr>
        `;

    });

    document.getElementById("hoje").textContent = hoje;
    document.getElementById("pendentes").textContent = pendentes;
    document.getElementById("confirmadas").textContent = confirmadas;
    document.getElementById("canceladas").textContent = canceladas;

}

window.abrirModal = function(id){

    const reserva = reservas.find(r => String(r.id) === String(id));

    if(!reserva) return;

    document.getElementById("mNome").textContent = reserva.clientes?.nome ?? "-";
    document.getElementById("mTelefone").textContent = reserva.clientes?.telefone ?? "-";
    document.getElementById("mData").textContent = reserva.data_reserva ?? "-";
    document.getElementById("mHorario").textContent = reserva.horario ?? "-";
    document.getElementById("mPessoas").textContent = reserva.pessoas ?? "-";
    document.getElementById("mAmbiente").textContent = reserva.ambiente_pref ?? "-";
    document.getElementById("mObs").textContent = reserva.observacoes ?? "-";
    document.getElementById("mStatus").textContent = reserva.status ?? "-";

    document.getElementById("modalReserva").style.display = "flex";

}

function fecharModal(){

    document.getElementById("modalReserva").style.display = "none";

}

carregarReservas();