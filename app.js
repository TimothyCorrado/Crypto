const CONFIG = {
  rpc: "https://pulsechain-rpc.publicnode.com",
  dexChainId: "pulsechain",
  maxDexBatch: 30
};

const elStatus = document.getElementById("status");
const elTotal = document.getElementById("total");
const elMeta = document.getElementById("meta");
const tbody = document.getElementById("rows");
const walletInput = document.getElementById("walletInput");
const tokensInput = document.getElementById("tokensInput");
const loadBtn = document.getElementById("loadBtn");
const clearBtn = document.getElementById("clearBtn");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

function setStatus(text, kind="ok"){
  elStatus.textContent = text;
  elStatus.className = `mono status ${kind}`;
}

function isAddress(x){ return /^0x[a-fA-F0-9]{40}$/.test(x); }
function shortAddr(a){ return a.slice(0,6)+"…"+a.slice(-4); }

function parseTokens(text){
  return text.split(/[\n,]+/).map(t=>t.trim()).filter(isAddress);
}

function usd(n){
  if(!Number.isFinite(n)) return "—";
  const a=Math.abs(n);
  let d=2; if(a<1)d=6; if(a<0.01)d=8;
  return "$"+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:d});
}

function pct(n){
  if(!Number.isFinite(n)) return "—";
  return n.toFixed(2)+"%";
}

function addRow(r){
  const tr=document.createElement("tr");
  tr.innerHTML=`
    <td>
      <div class="tokenName">${r.label}</div>
      <div class="mono">${shortAddr(r.address)}</div>
    </td>
    <td class="mono">${r.balance}</td>
    <td class="mono">${r.price}</td>
    <td class="mono">${r.value}</td>
    <td class="mono">${r.change24h}</td>
    <td class="mono err">${r.error||""}</td>
  `;
  tbody.appendChild(tr);
}

// Dexscreener batch pricing
async function fetchDexBatch(tokens){
  const url=`https://api.dexscreener.com/tokens/v1/${CONFIG.dexChainId}/${tokens.join(",")}`;
  const r=await fetch(url);
  if(!r.ok) throw new Error("Dexscreener error");
  return r.json();
}

async function getPrices(tokens){
  const map=new Map();
  for(let i=0;i<tokens.length;i+=CONFIG.maxDexBatch){
    const chunk=tokens.slice(i,i+CONFIG.maxDexBatch);
    const pairs=await fetchDexBatch(chunk);
    const grouped={};
    chunk.forEach(t=>grouped[t.toLowerCase()]=[]);
    for(const p of pairs){
      const b=p?.baseToken?.address?.toLowerCase();
      const q=p?.quoteToken?.address?.toLowerCase();
      if(grouped[b]) grouped[b].push(p);
      if(grouped[q]) grouped[q].push(p);
    }
    for(const t of chunk){
      const list=grouped[t.toLowerCase()]||[];
      let best=null,liq=-1;
      for(const p of list){
        if(!p?.priceUsd) continue;
        const l=p.liquidity?.usd||0;
        if(l>liq){ best=p; liq=l; }
      }
      map.set(t.toLowerCase(),{
        price: best?Number(best.priceUsd):null,
        change: best?.priceChange?.h24 ?? null
      });
    }
  }
  return map;
}

async function load(){
  tbody.innerHTML="";
  elTotal.textContent="$0.00";
  elMeta.textContent="—";

  const wallet=walletInput.value.trim();
  const tokens=parseTokens(tokensInput.value);

  if(!isAddress(wallet)){ setStatus("Invalid wallet address","warn"); return; }
  if(!tokens.length){ setStatus("Enter at least one token","warn"); return; }

  setStatus("Connecting RPC…");
  const provider=new ethers.JsonRpcProvider(CONFIG.rpc);
  try{ await provider.getBlockNumber(); }
  catch{ setStatus("RPC blocked","warn"); return; }

  setStatus("Fetching prices…");
  const prices=await getPrices(tokens);

  setStatus("Loading balances…");
  let total=0, priced=0;

  for(const addr of tokens){
    try{
      const c=new ethers.Contract(addr,ERC20_ABI,provider);
      const [balRaw,dec,sym]=await Promise.all([
        c.balanceOf(wallet),
        c.decimals().catch(()=>18),
        c.symbol().catch(()=> "TOKEN")
      ]);
      const amt=Number(ethers.formatUnits(balRaw,dec));
      const px=prices.get(addr.toLowerCase());
      if(!px||px.price==null){
        addRow({label:sym,address:addr,balance:amt.toLocaleString(),price:"—",value:"—",change24h:"—",error:"No price"});
        continue;
      }
      const val=amt*px.price;
      total+=val; priced++;
      addRow({
        label:sym,
        address:addr,
        balance:amt.toLocaleString(),
        price:usd(px.price),
        value:usd(val),
        change24h:pct(px.change)
      });
    }catch(e){
      addRow({label:"Token",address:addr,error:e.message});
    }
  }

  elTotal.textContent=usd(total);
  elMeta.textContent=`Tokens: ${tokens.length} • Priced: ${priced}`;
  setStatus("Loaded ✓");
}

loadBtn.onclick=load;
clearBtn.onclick=()=>{
  walletInput.value="";
  tokensInput.value="";
  tbody.innerHTML="";
  elTotal.textContent="$0.00";
  elMeta.textContent="—";
  setStatus("Cleared");
};
