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
`);

reservas = data;

    console.log(data[0]);
        
console.log("ERRO:", error);
console.log("DADOS:", data);
    if (error) {
        console.error(error);
        alert("Erro ao carregar reservas.");
        return;
    }

    console.log("TESTE NOVO");

    const tabela = document.getElementById("tabelaReservas");
    tabela.innerHTML = "";

    data.forEach(reserva => {

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
                    <button onclick="alert('clicou')">Ver</button>
                </td>
            </tr>
        `;

    });

}

carregarReservas();
window.abrirModal = function(id) {
    console.log("ABRIU O MODAL", id);

    const reserva = reservas.find(r => r.id === id);

    if (!reserva) return;

    const ids = [
  "modalReserva",
  "mNome",
  "mTelefone",
  "mData",
  "mHorario",
  "mPessoas",
  "mAmbiente",
  "mObs",
  "mStatus"
];

ids.forEach(id => {
  console.log(id, document.getElementById(id));
});

    document.getElementById("modalReserva").style.display = "block";
}

function fecharModal() {
    document.getElementById("modalReserva").style.display = "none";
}
