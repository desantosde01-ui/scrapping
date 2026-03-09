const express = require("express");
const cors = require("cors");
const { ApifyClient } = require("apify-client");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const jobs = {};

function generateJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

app.post("/api/scrape", async (req, res) => {
  const { apiToken, cidades, maxResultados = 20, notaMinima = 3.5 } = req.body;
  if (!apiToken || !cidades || cidades.length === 0) {
    return res.status(400).json({ error: "apiToken e cidades são obrigatórios." });
  }
  const jobId = generateJobId();
  jobs[jobId] = { status: "running", progress: [], leads: [], error: null, startedAt: new Date() };
  res.json({ jobId });
  runScraping(jobId, apiToken, cidades, maxResultados, notaMinima);
});

app.get("/api/job/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job não encontrado." });
  res.json(job);
});

app.get("/api/job/:jobId/download", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== "done") return res.status(404).json({ error: "Job não concluído." });
  const md = generateMarkdown(job.leads);
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", `attachment; filename="leads_petshop_${req.params.jobId}.md"`);
  res.send(md);
});

async function runScraping(jobId, apiToken, cidades, maxResultados, notaMinima) {
  const client = new ApifyClient({ token: apiToken });
  const termos = ["petshop banho e tosa", "petshop", "banho e tosa"];
  const todosItens = [];

  try {
    for (const cidade of cidades) {
      for (const termo of termos) {
        const query = `${termo} ${cidade}`;
        jobs[jobId].progress.push({ type: "search", msg: `🔍 Buscando: ${query}`, ts: new Date() });
        try {
          const run = await client.actor("compass/crawler-google-places").call({
            searchStringsArray: [query],
            maxCrawledPlacesPerSearch: maxResultados,
            language: "pt-BR",
            countryCode: "br",
          });
          const items = [];
          for await (const item of client.dataset(run.defaultDatasetId).iterate()) {
            items.push(item);
          }
          todosItens.push(...items);
          jobs[jobId].progress.push({ type: "ok", msg: `✅ ${items.length} resultados para "${query}"`, ts: new Date() });
        } catch (e) {
          jobs[jobId].progress.push({ type: "err", msg: `❌ Erro em "${query}": ${e.message}`, ts: new Date() });
        }
      }
    }
    const leads = extractLeads(todosItens, notaMinima);
    leads.sort((a, b) => (parseFloat(b.nota) || 0) - (parseFloat(a.nota) || 0));
    jobs[jobId].leads = leads;
    jobs[jobId].status = "done";
    jobs[jobId].progress.push({ type: "done", msg: `🎉 Concluído! ${leads.length} leads coletados.`, ts: new Date() });
  } catch (e) {
    jobs[jobId].status = "error";
    jobs[jobId].error = e.message;
  }
}

function extractLeads(itens, notaMinima) {
  const leads = [];
  const vistos = new Set();
  for (const item of itens) {
    const placeId = item.placeId || item.id;
    if (!placeId || vistos.has(placeId)) continue;
    vistos.add(placeId);
    const nota = parseFloat(item.totalScore || item.rating || 0);
    if (nota && nota < notaMinima) continue;
    const horarios = Array.isArray(item.openingHours)
      ? item.openingHours.slice(0, 3).map(h => `${h.day}: ${h.hours}`).join(" | ")
      : "—";
    const categorias = Array.isArray(item.categories) ? item.categories.join(", ") : "—";
    leads.push({
      nome: item.title || item.name || "Sem nome",
      endereco: item.address || item.street || "—",
      cidade: item.city || "—",
      telefone: (item.phone || item.phoneUnformatted || "—").trim(),
      website: item.website || "—",
      nota: nota || "—",
      reviews: item.reviewsCount || item.totalReviews || 0,
      categorias,
      horario: horarios,
      googleMaps: item.url || item.shareUrl || "—",
    });
  }
  return leads;
}

function generateMarkdown(leads) {
  const agora = new Date().toLocaleString("pt-BR");
  const lines = [];
  lines.push("# 🐾 Leads — Petshops (Banho e Tosa)");
  lines.push(`\n> **Gerado em:** ${agora}  `);
  lines.push(`> **Total de leads:** ${leads.length}\n`);
  lines.push("---\n");
  lines.push("## 📋 Tabela Resumo\n");
  lines.push("| # | Nome | Cidade | Telefone | Nota | Reviews | Website |");
  lines.push("|---|------|--------|----------|------|---------|---------|");
  leads.forEach((l, i) => {
    const site = l.website !== "—" ? `[🔗 site](${l.website})` : "—";
    const nota = l.nota !== "—" ? `⭐ ${l.nota}` : "—";
    lines.push(`| ${i + 1} | ${l.nome} | ${l.cidade} | ${l.telefone} | ${nota} | ${l.reviews} | ${site} |`);
  });
  lines.push("\n---\n");
  lines.push("## 🗂️ Leads Detalhados\n");
  leads.forEach((l, i) => {
    lines.push(`### ${i + 1}. ${l.nome}`);
    lines.push(`- 📍 **Endereço:** ${l.endereco}, ${l.cidade}`);
    lines.push(`- 📞 **Telefone:** ${l.telefone}`);
    lines.push(`- 🌐 **Website:** ${l.website}`);
    lines.push(`- ⭐ **Nota:** ${l.nota} (${l.reviews} avaliações)`);
    lines.push(`- 🏷️ **Categorias:** ${l.categorias}`);
    lines.push(`- 🕐 **Horários:** ${l.horario}`);
    lines.push(`- 🗺️ **Google Maps:** ${l.googleMaps}`);
    lines.push("");
    let abordagem = "";
    const reviews = parseInt(l.reviews) || 0;
    if (reviews < 20) {
      abordagem = `_"Oi! Vi o ${l.nome} no Google e notei que vocês têm poucos reviews — posso te mostrar como dobrar isso em 30 dias. Posso enviar um diagnóstico grátis?"_`;
    } else if (l.website === "—") {
      abordagem = `_"Oi! Vi o ${l.nome} e notei que vocês ainda não têm site. Hoje 70% dos tutores pesquisam online antes de escolher petshop. Bora conversar?"_`;
    } else {
      abordagem = `_"Oi! Vi o ${l.nome} no Google e queria entender como vocês captam novos clientes hoje. Tenho uma estratégia específica para petshops. Posso mostrar em 15 min?"_`;
    }
    lines.push("**💬 Sugestão de abordagem:**");
    lines.push(`> ${abordagem}`);
    lines.push("\n---\n");
  });
  return lines.join("\n");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
