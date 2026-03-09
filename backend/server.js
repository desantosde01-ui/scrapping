const express = require("express");
const cors = require("cors");
const { ApifyClient } = require("apify-client");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const SUPABASE_URL = "https://gducplygsupgztgublqh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkdWNwbHlnc3VwZ3p0Z3VibHFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzQ5ODUsImV4cCI6MjA4ODMxMDk4NX0.yyriwmRGq6PLgcyH7DyEd34nh2cAdHfw8EHwYt8TTnA";

const jobs = {};

function generateJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function upsertLeadsSupabase(leads) {
  const rows = leads.map(l => ({
    placeUrl: l.placeId,
    title: l.nome,
    rating: l.nota !== "—" ? String(l.nota) : null,
    reviewCount: l.reviews ? String(l.reviews) : null,
    category: l.categorias !== "—" ? l.categorias : null,
    address: l.endereco !== "—" ? `${l.endereco}, ${l.cidade}` : null,
    website: l.website !== "—" ? l.website : null,
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "resolution=ignore-duplicates",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase erro: ${err}`);
  }
  return rows.length;
}

app.post("/api/scrape", async (req, res) => {
  const {
    apiToken, nicho, quantidade = 20, notaMinima = 3.5,
    lat, lng, raioInicial = 5000, autoExpandir = true,
  } = req.body;

  if (!apiToken || !nicho) {
    return res.status(400).json({ error: "apiToken e nicho são obrigatórios." });
  }

  const jobId = generateJobId();
  jobs[jobId] = { status: "running", progress: [], leads: [], error: null, startedAt: new Date(), nicho };
  res.json({ jobId });
  runScraping(jobId, apiToken, nicho, quantidade, notaMinima, lat, lng, raioInicial, autoExpandir);
});

app.get("/api/job/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job não encontrado." });
  res.json(job);
});

app.get("/api/job/:jobId/download", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== "done") return res.status(404).json({ error: "Job não concluído." });
  const md = generateMarkdown(job.leads, job.nicho);
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", `attachment; filename="leads_${(job.nicho||'leads').replace(/\s+/g,'_')}_${req.params.jobId}.md"`);
  res.send(md);
});

function raioParaZoom(raioMetros) {
  if (raioMetros <= 1000)  return 15;
  if (raioMetros <= 3000)  return 14;
  if (raioMetros <= 5000)  return 13;
  if (raioMetros <= 10000) return 12;
  if (raioMetros <= 20000) return 11;
  return 10;
}

async function runScraping(jobId, apiToken, nicho, quantidade, notaMinima, lat, lng, raioInicial, autoExpandir) {
  const client = new ApifyClient({ token: apiToken });
  const todosItens = [];
  const raiosExpansao = [raioInicial, 10000, 20000, 50000].filter(r => r >= raioInicial);

  try {
    for (const raio of raiosExpansao) {
      const raioKm = (raio / 1000).toFixed(0);
      jobs[jobId].progress.push({ type: "search", msg: `🔍 Buscando "${nicho}" — raio ${raioKm}km...`, ts: new Date() });

      const input = {
        searchStringsArray: [nicho],
        maxCrawledPlacesPerSearch: quantidade * 2,
        language: "pt-BR",
        countryCode: "br",
      };

      if (lat && lng) {
        input.lat = parseFloat(lat);
        input.lng = parseFloat(lng);
        input.zoom = raioParaZoom(raio);
      }

      try {
        const run = await client.actor("compass/crawler-google-places").call(input);
        const dataset = await client.dataset(run.defaultDatasetId).listItems();
        const items = dataset.items || [];
        const idsExistentes = new Set(todosItens.map(i => i.placeId || i.id));
        const novos = items.filter(i => !idsExistentes.has(i.placeId || i.id));
        todosItens.push(...novos);

        jobs[jobId].progress.push({ type: "ok", msg: `✅ ${novos.length} novos resultados (total: ${todosItens.length})`, ts: new Date() });

        const leadsValidos = extractLeads(todosItens, notaMinima);
        if (leadsValidos.length >= quantidade) {
          jobs[jobId].progress.push({ type: "ok", msg: `🎯 Meta de ${quantidade} leads atingida!`, ts: new Date() });
          break;
        }

        if (!autoExpandir) break;

        if (leadsValidos.length < quantidade && raio !== raiosExpansao[raiosExpansao.length - 1]) {
          const proxRaio = raiosExpansao[raiosExpansao.indexOf(raio) + 1];
          jobs[jobId].progress.push({ type: "search", msg: `⚠️ Apenas ${leadsValidos.length} leads. Expandindo para ${(proxRaio/1000).toFixed(0)}km...`, ts: new Date() });
        }
      } catch (e) {
        jobs[jobId].progress.push({ type: "err", msg: `❌ Erro: ${e.message}`, ts: new Date() });
        if (!autoExpandir) break;
      }
    }

    const leads = extractLeads(todosItens, notaMinima).slice(0, quantidade);
    leads.sort((a, b) => (parseFloat(b.nota) || 0) - (parseFloat(a.nota) || 0));

    jobs[jobId].progress.push({ type: "search", msg: `☁️ Salvando ${leads.length} leads no Supabase...`, ts: new Date() });
    try {
      await upsertLeadsSupabase(leads);
      jobs[jobId].progress.push({ type: "ok", msg: `✅ Leads salvos! Duplicatas ignoradas.`, ts: new Date() });
    } catch (e) {
      jobs[jobId].progress.push({ type: "err", msg: `❌ Erro Supabase: ${e.message}`, ts: new Date() });
    }

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
      ? item.openingHours.slice(0, 3).map(h => `${h.day}: ${h.hours}`).join(" | ") : "—";
    const categorias = Array.isArray(item.categories) ? item.categories.join(", ") : "—";
    leads.push({
      placeId,
      nome: item.title || item.name || "Sem nome",
      endereco: item.address || item.street || "—",
      cidade: item.city || "—",
      telefone: (item.phone || item.phoneUnformatted || "—").trim(),
      website: item.website || "—",
      nota: nota || "—",
      reviews: item.reviewsCount || item.totalReviews || 0,
      categorias, horario: horarios,
      googleMaps: item.url || item.shareUrl || "—",
      lat: item.location?.lat || item.lat || null,
      lng: item.location?.lng || item.lng || null,
    });
  }
  return leads;
}

function generateMarkdown(leads, nicho = "leads") {
  const agora = new Date().toLocaleString("pt-BR");
  const lines = [];
  lines.push(`# 📍 Leads — ${nicho}`);
  lines.push(`\n> **Gerado em:** ${agora}  \n> **Total:** ${leads.length}\n`);
  lines.push("---\n");
  lines.push("## 📋 Tabela Resumo\n");
  lines.push("| # | Nome | Cidade | Telefone | Nota | Reviews | Website |");
  lines.push("|---|------|--------|----------|------|---------|---------|");
  leads.forEach((l, i) => {
    const site = l.website !== "—" ? `[🔗 site](${l.website})` : "—";
    const nota = l.nota !== "—" ? `⭐ ${l.nota}` : "—";
    lines.push(`| ${i+1} | ${l.nome} | ${l.cidade} | ${l.telefone} | ${nota} | ${l.reviews} | ${site} |`);
  });
  lines.push("\n---\n## 🗂️ Leads Detalhados\n");
  leads.forEach((l, i) => {
    lines.push(`### ${i+1}. ${l.nome}`);
    lines.push(`- 📍 **Endereço:** ${l.endereco}, ${l.cidade}`);
    lines.push(`- 📞 **Telefone:** ${l.telefone}`);
    lines.push(`- 🌐 **Website:** ${l.website}`);
    lines.push(`- ⭐ **Nota:** ${l.nota} (${l.reviews} avaliações)`);
    lines.push(`- 🏷️ **Categorias:** ${l.categorias}`);
    lines.push(`- 🕐 **Horários:** ${l.horario}`);
    lines.push(`- 🗺️ **Google Maps:** ${l.googleMaps}\n`);
    const reviews = parseInt(l.reviews) || 0;
    let ab = reviews < 20
      ? `_"Oi! Vi o ${l.nome} no Google — poucos reviews. Posso mostrar como dobrar em 30 dias. Diagnóstico grátis?"_`
      : l.website === "—"
        ? `_"Oi! Vi o ${l.nome} e notei que não têm site. 70% dos clientes pesquisam online antes. Bora conversar?"_`
        : `_"Oi! Vi o ${l.nome} no Google. Tenho uma estratégia específica pro seu segmento. Posso mostrar em 15 min?"_`;
    lines.push(`**💬 Abordagem sugerida:**\n> ${ab}\n\n---\n`);
  });
  return lines.join("\n");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
