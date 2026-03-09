# 🐾 PetLeads — Gerador de Leads para Petshops

Aplicação web para buscar leads de petshops (banho e tosa) via Apify Google Maps Scraper.

---

## 🚀 Deploy no EasyPanel

### Passo 1 — Suba o projeto para o GitHub
1. Crie um repositório no GitHub (pode ser privado)
2. Faça upload de todos estes arquivos para o repositório

### Passo 2 — No EasyPanel
1. Acesse seu EasyPanel → clique em **"New Service"**
2. Escolha **"App"** → conecte ao seu repositório GitHub
3. Em **"Build Method"**, selecione **Dockerfile**
4. Em **"Port"**, coloque `3000`
5. Clique em **Deploy**

### Passo 3 — Acesse a aplicação
Após o deploy, clique na URL gerada pelo EasyPanel e a interface já estará pronta.

---

## 🖥️ Como usar a aplicação

1. **Cole seu Token Apify** no campo de API Token
2. **Selecione as cidades** que deseja pesquisar
3. Ajuste o máximo de resultados e nota mínima (opcional)
4. Clique em **"Iniciar Scraping"**
5. Acompanhe o progresso em tempo real no log
6. Ao concluir, visualize os leads na tabela
7. Clique em **"Baixar leads_petshop.md"** para exportar

---

## 📁 Estrutura do projeto

```
petshop-scraper/
├── Dockerfile
├── package.json
├── backend/
│   └── server.js        ← API Express + lógica Apify
└── frontend/
    └── index.html       ← Interface web
```

---

## ⚙️ Variáveis de ambiente (opcional)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT`   | `3000` | Porta do servidor |
