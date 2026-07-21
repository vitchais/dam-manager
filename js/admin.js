async function carregarReservas() {

    const { data, error } = await supabaseClient
    .from("reservas")
    .select(`
        *,
        clientes (
            nome,
            telefone
        )
    `);
        
console.log("ERRO:", error);
console.log("DADOS:", data);
    if (error) {
        console.error(error);
        alert("Erro ao carregar reservas.");
        return;
    }

    console.log(data);

    const tabela = document.getElementById("tabelaReservas");
    tabela.innerHTML = "";

    data.forEach(reserva => {

        tabela.innerHTML += `
            <tr>
                <td>${reserva.clientes?.nome ?? "-"}</td>
                <td>${reserva.clientes?.telefone ?? "-"}</td>
                <td>${reserva.data_reserva ?? "-"}</td>
                <td>${reserva.horario ?? "-"}</td>
                <td>${reserva.quantidade_pessoas ?? "-"}</td>
                <td>${reserva.ambiente ?? "-"}</td>
                <td>${reserva.status ?? "-"}</td>
                <td>
                    <button>Ver</button>
                </td>
            </tr>
        `;

    });

}

carregarReservas();