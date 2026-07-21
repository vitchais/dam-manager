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
                    <button>Ver</button>
                </td>
            </tr>
        `;

    });

}

carregarReservas();