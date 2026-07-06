/* Clutch Studios — studio deck (dark premium). Run: node build-deck.js */
const path = require("path");
const pptxgen = require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "pptxgenjs"));

const P = { bg:"05060F", panel:"12141D", panel2:"0D0F17", line:"2A3142",
  cyan:"22D3EE", purple:"8B3FFF", pink:"FF2E97", gold:"FFD23F", green:"2BFF88",
  white:"F4F7FF", muted:"93A0BA", dim:"6C7690" };
const HEAD="Trebuchet MS", BODY="Calibri", MONO="Consolas";
const W=13.3, H=7.5, M=0.7;
const shadow=()=>({ type:"outer", color:"000000", blur:9, offset:3, angle:135, opacity:0.45 });

const pres = new pptxgen();
pres.defineLayout({ name:"WIDE", width:W, height:H });
pres.layout="WIDE";
pres.author="Clutch Studios"; pres.title="Clutch Studios — Studio Deck";

function bg(s){ s.background={color:P.bg}; }
function glow(s,x,y,d,color,tr=88){ s.addShape(pres.shapes.OVAL,{x,y,w:d,h:d,fill:{color,transparency:tr},line:{type:"none"}}); }
function label(s,t,x,y,color=P.cyan){ s.addText(t.toUpperCase(),{x,y,w:8,h:0.3,margin:0,fontFace:MONO,fontSize:11,color,charSpacing:3,bold:true}); }
function card(s,x,y,w,h,fill=P.panel){ s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x,y,w,h,rectRadius:0.09,fill:{color:fill},line:{color:P.line,width:1},shadow:shadow()}); }
function badge(s,x,y,color,txt){ s.addShape(pres.shapes.OVAL,{x,y,w:0.5,h:0.5,fill:{color},line:{type:"none"}}); s.addText(txt,{x,y,w:0.5,h:0.5,margin:0,align:"center",valign:"middle",fontFace:HEAD,fontSize:16,bold:true,color:"05060F"}); }

/* 1 — TITLE */
let s=pres.addSlide(); bg(s);
glow(s,-1.6,-1.8,6,P.cyan,86); glow(s,9.5,-2.2,7,P.purple,87); glow(s,7,5.2,6,P.pink,90);
s.addText("▲",{x:M,y:1.35,w:1,h:1,margin:0,fontFace:HEAD,fontSize:46,bold:true,color:P.cyan});
s.addText([{text:"CLUTCH ",options:{color:P.cyan}},{text:"STUDIOS",options:{color:P.purple}}],
  {x:M,y:2.25,w:11.9,h:1.3,margin:0,fontFace:HEAD,fontSize:60,bold:true,charSpacing:1});
s.addText("Provably-fair instant games — server-authoritative, and built to certify.",
  {x:M,y:3.55,w:11,h:0.6,margin:0,fontFace:BODY,fontSize:22,color:P.white});
s.addText("Six live games. Three mechanics. One integration. Playable right now.",
  {x:M,y:4.15,w:11,h:0.5,margin:0,fontFace:BODY,fontSize:16,color:P.muted});
s.addText([{text:"▶  Play the whole catalogue in 60 seconds  ",options:{color:P.cyan}},{text:"clutchstudios.co/play",options:{color:P.white,bold:true}}],
  {x:M,y:5.35,w:11,h:0.45,margin:0,fontFace:MONO,fontSize:14});
s.addText("[Founder name] · team@clutchstudios.co",{x:M,y:6.55,w:11,h:0.4,margin:0,fontFace:MONO,fontSize:12,color:P.dim});

/* 2 — ONE-LINER */
s=pres.addSlide(); bg(s); glow(s,10.5,-2,6,P.purple,90);
label(s,"What we do",M,0.75);
s.addText([{text:"Six live games. ",options:{color:P.white}},{text:"Three mechanics. ",options:{color:P.cyan}},{text:"One integration.",options:{color:P.purple}}],
  {x:M,y:1.25,w:12,h:1.5,margin:0,fontFace:HEAD,fontSize:44,bold:true,lineSpacingMultiple:1.02});
s.addText("We build crash and instant games for the operators your network serves — mobile-first, provably fair, and verifiable every round. All of it runs on one server-authoritative RGS, on one integration, and you can play every title in a browser today.",
  {x:M,y:3.35,w:11.5,h:1.5,margin:0,fontFace:BODY,fontSize:19,color:P.white,lineSpacingMultiple:1.15});
card(s,M,5.35,11.9,1.35,P.panel);
s.addText([{text:"Most studios pitch a deck and a promise.  ",options:{color:P.muted}},{text:"We pitch a link.",options:{color:P.pink,bold:true,italic:true}}],
  {x:M+0.4,y:5.55,w:11,h:0.5,margin:0,fontFace:BODY,fontSize:22});
s.addText("clutchstudios.co/play  ·  flagship: /zenith  ·  verify fairness: /fairness",{x:M+0.4,y:6.1,w:11,h:0.4,margin:0,fontFace:MONO,fontSize:13,color:P.cyan});

/* 3 — FLAGSHIP ZENITH */
s=pres.addSlide(); bg(s); glow(s,-1.5,4.5,5,P.cyan,90);
label(s,"The flagship",M,0.7);
s.addText("Zenith",{x:M,y:1.1,w:6,h:0.9,margin:0,fontFace:HEAD,fontSize:46,bold:true,color:P.cyan});
s.addText("A shared-round vertical climb. One climber, everyone in the round watches together — altitude is your multiplier, secure it before the fall.",
  {x:M,y:2.15,w:6.6,h:1.2,margin:0,fontFace:BODY,fontSize:18,color:P.white,lineSpacingMultiple:1.15});
s.addText([
  {text:"Not another clone. ",options:{bold:true,color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Same proven, addictive core (shared rising multiplier + one cash-out decision) in a genuinely fresh identity — a 3D neon ascent, not a plane on a curve.",options:{color:P.muted,breakLine:true}},
  {text:"Engineered on evidence. ",options:{bold:true,color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Stacks the levers behind Aviator-class stickiness: the shared “now,” a single decision (illusion of control), fast cadence, and clip-ready fall moments.",options:{color:P.muted}},
], {x:M,y:3.5,w:6.7,h:2.8,margin:0,fontFace:BODY,fontSize:14,lineSpacingMultiple:1.1,paraSpaceAfter:8});
// right: abstract game card
const cx=8.15, cw=4.45;
card(s,cx,1.1,cw,5.5,P.panel2);
s.addText("▲ ZENITH",{x:cx,y:1.4,w:cw,h:0.4,margin:0,align:"center",fontFace:MONO,fontSize:13,color:P.cyan,charSpacing:2,bold:true});
// ascending ring gates
const ringY=[5.3,4.5,3.7,2.9]; const ringColors=[P.cyan,P.cyan,P.purple,P.pink];
ringY.forEach((ry,i)=>{ s.addShape(pres.shapes.OVAL,{x:cx+cw/2-0.9,y:ry,w:1.8,h:0.55,fill:{type:"none"},line:{color:ringColors[i],width:2.5}}); });
s.addShape(pres.shapes.OVAL,{x:cx+cw/2-0.28,y:3.75,w:0.56,h:0.56,fill:{color:P.cyan},line:{type:"none"}}); // climber
s.addText("▲",{x:cx+cw/2-0.28,y:3.79,w:0.56,h:0.48,margin:0,align:"center",valign:"middle",fontFace:HEAD,fontSize:18,bold:true,color:"05060F"});
s.addText("12.40×",{x:cx,y:2.15,w:cw,h:0.7,margin:0,align:"center",fontFace:HEAD,fontSize:40,bold:true,color:P.gold});
s.addText("ALTITUDE = MULTIPLIER",{x:cx,y:5.95,w:cw,h:0.4,margin:0,align:"center",fontFace:MONO,fontSize:11,color:P.muted,charSpacing:2});

/* 4 — CATALOGUE */
s=pres.addSlide(); bg(s); glow(s,11,5.5,5,P.pink,91);
label(s,"The catalogue",M,0.7);
s.addText("Range from one supplier",{x:M,y:1.1,w:11,h:0.7,margin:0,fontFace:HEAD,fontSize:36,bold:true,color:P.white});
const rows=[
  [{text:"MECHANIC",options:{fill:{color:P.panel},color:P.cyan,bold:true,fontFace:MONO,fontSize:12}},{text:"TITLES",options:{fill:{color:P.panel},color:P.cyan,bold:true,fontFace:MONO,fontSize:12}}],
  [{text:"Crash",options:{color:P.white,bold:true,fontSize:17}},{text:"Ascent  ·  Overdrive (3D turbo car-crash)",options:{color:P.muted,fontSize:16}}],
  [{text:"Step-multiplier climb",options:{color:P.white,bold:true,fontSize:17}},{text:"Zenith  (flagship)  ·  Ascent Cross  ·  Redline",options:{color:P.muted,fontSize:16}}],
  [{text:"Mines",options:{color:P.white,bold:true,fontSize:17}},{text:"Vault  (25-tile, player-set volatility)",options:{color:P.muted,fontSize:16}}],
];
s.addTable(rows,{x:M,y:2.2,w:11.9,colW:[3.6,8.3],rowH:[0.5,0.85,0.85,0.85],fill:{color:P.panel2},
  border:{type:"solid",color:P.line,pt:1},valign:"middle",margin:[4,10,4,10]});
card(s,M,6.25,11.9,0.75,P.panel);
s.addText([{text:"One onboarding, three player audiences.  ",options:{color:P.white,bold:true}},{text:"Adding the next title is a config change, not a new integration.",options:{color:P.muted}}],
  {x:M+0.4,y:6.42,w:11.2,h:0.4,margin:0,fontFace:BODY,fontSize:15});

/* 5 — TECHNOLOGY */
s=pres.addSlide(); bg(s); glow(s,-1.5,-1.5,5,P.cyan,90);
label(s,"The technology",M,0.7);
s.addText("A production, server-authoritative RGS",{x:M,y:1.1,w:11.5,h:0.7,margin:0,fontFace:HEAD,fontSize:34,bold:true,color:P.white});
const tech=[
  [P.cyan,"1","Server-authoritative","Outcomes, balances and timing all decided server-side — the client is a thin renderer. The #1 certification requirement."],
  [P.purple,"2","Provably fair","Pre-committed server-seed hash chain + player entropy + public block-hash (crash); commit-reveal shuffles (mines/climb). Verifiable every round."],
  [P.pink,"3","Seamless wallet","Idempotent debit / credit / rollback by txId, integer minor units, auto-reconciliation. A per-aggregator adapter maps to your wallet API."],
  [P.gold,"4","Built to certify","Deterministic replay, append-only audit logs, an RTP harness. The GLI-19 technical pack is largely in place."],
];
let ty=2.15;
tech.forEach(([c,n,h,d])=>{ badge(s,M,ty,c,n);
  s.addText(h,{x:M+0.75,y:ty-0.06,w:11,h:0.4,margin:0,fontFace:HEAD,fontSize:18,bold:true,color:P.white});
  s.addText(d,{x:M+0.75,y:ty+0.34,w:11.1,h:0.6,margin:0,fontFace:BODY,fontSize:14,color:P.muted,lineSpacingMultiple:1.05});
  ty+=1.15; });

/* 6 — WHY PROVABLY FAIR */
s=pres.addSlide(); bg(s); glow(s,9.5,-2,7,P.purple,88); glow(s,1,5.5,5,P.cyan,91);
label(s,"Why now",M,0.75);
s.addText([{text:"121",options:{color:P.pink}},{text:" of ",options:{color:P.muted}},{text:"378",options:{color:P.white}},{text:" crash titles",options:{color:P.muted}}],
  {x:M,y:1.35,w:12,h:1.1,margin:0,fontFace:HEAD,fontSize:52,bold:true});
s.addText("launched in 2025 alone. The category is saturated with reskins — so a plain clone is a dead end.",
  {x:M,y:2.65,w:11.5,h:0.8,margin:0,fontFace:BODY,fontSize:20,color:P.white,lineSpacingMultiple:1.1});
card(s,M,4.05,11.9,2.4,P.panel);
s.addText("Our edge",{x:M+0.4,y:4.3,w:11,h:0.4,margin:0,fontFace:MONO,fontSize:12,color:P.cyan,charSpacing:2,bold:true});
s.addText([
  {text:"A differentiated flagship, not a reskin — Zenith gives players a fresh experience on a proven core.",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Provably fair is a real, marketed feature for crypto-forward operators — the segment most open to new studios. We're built for it natively.",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Aviator won on craft, not a novel mechanic. Our bet is the same: out-craft a proven core with an original identity.",options:{color:P.white,bullet:{indent:14}}},
],{x:M+0.4,y:4.75,w:11.1,h:1.6,margin:0,fontFace:BODY,fontSize:14.5,lineSpacingMultiple:1.1,paraSpaceAfter:6});

/* 7 — TEAM */
s=pres.addSlide(); bg(s); glow(s,11,-2,6,P.cyan,90);
label(s,"The team",M,0.75);
s.addText("Small, technical, shipping.",{x:M,y:1.25,w:11,h:0.8,margin:0,fontFace:HEAD,fontSize:38,bold:true,color:P.white});
card(s,M,2.5,11.9,3.4,P.panel);
s.addText("[Founder name] — Founder",{x:M+0.5,y:2.85,w:11,h:0.5,margin:0,fontFace:HEAD,fontSize:22,bold:true,color:P.cyan});
s.addText("[One honest line about who you are and any real, verifiable background. If you're solo and new, say so plainly — e.g. “Independent founder; designed and built the RGS and all six games.” A true, modest line beats an inflated résumé.]",
  {x:M+0.5,y:3.45,w:11,h:1.4,margin:0,fontFace:BODY,fontSize:17,color:P.muted,italic:true,lineSpacingMultiple:1.2});
s.addText("Replace this slide's bracketed text before sending. Do not invent a team or credentials.",
  {x:M+0.5,y:5.25,w:11,h:0.4,margin:0,fontFace:MONO,fontSize:11,color:P.dim});

/* 8 — HONEST STATUS */
s=pres.addSlide(); bg(s);
label(s,"Honest status",M,0.7);
s.addText("What's real, and what's next",{x:M,y:1.1,w:11,h:0.7,margin:0,fontFace:HEAD,fontSize:34,bold:true,color:P.white});
const colW=5.75;
card(s,M,2.2,colW,3.4,P.panel);
s.addText("BUILT & PLAYABLE TODAY",{x:M+0.4,y:2.45,w:colW-0.8,h:0.4,margin:0,fontFace:MONO,fontSize:12,color:P.green,charSpacing:2,bold:true});
s.addText([
  {text:"A server-authoritative, provably-fair RGS",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Six live games across three mechanics",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"A differentiated flagship (Zenith)",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Seamless-wallet contract + RTP harness",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Deterministic replay + audit logs",options:{color:P.white,bullet:{indent:14}}},
],{x:M+0.4,y:2.95,w:colW-0.7,h:2.4,margin:0,fontFace:BODY,fontSize:15,lineSpacingMultiple:1.15,paraSpaceAfter:7});
card(s,M+colW+0.4,2.2,colW,3.4,P.panel);
s.addText("IN PROGRESS BEFORE GO-LIVE",{x:M+colW+0.8,y:2.45,w:colW-0.8,h:0.4,margin:0,fontFace:MONO,fontSize:12,color:P.gold,charSpacing:2,bold:true});
s.addText([
  {text:"Accredited-lab certification (GLI / iTech)",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"B2B supplier licensing",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Production persistence (Postgres audit)",options:{color:P.white,bullet:{indent:14}}},
],{x:M+colW+0.8,y:2.95,w:colW-0.7,h:2,margin:0,fontFace:BODY,fontSize:15,lineSpacingMultiple:1.15,paraSpaceAfter:7});
card(s,M,5.85,11.9,1.05,P.panel2);
s.addText([{text:"— which is exactly why we're applying to your program.  ",options:{color:P.white,bold:true}},{text:"We bring the games and the tech; you bring the certified platform and distribution.",options:{color:P.muted}}],
  {x:M+0.4,y:6.12,w:11.2,h:0.5,margin:0,fontFace:BODY,fontSize:15,lineSpacingMultiple:1.05});

/* 9 — THE ASK */
s=pres.addSlide(); bg(s); glow(s,-1.5,-1.5,5,P.purple,89); glow(s,10.5,5,5,P.cyan,91);
label(s,"The ask",M,0.75);
s.addText("Accept Clutch into your studio program.",{x:M,y:1.25,w:12,h:1,margin:0,fontFace:HEAD,fontSize:38,bold:true,color:P.white});
s.addText("We launch Zenith as the flagship, followed by the catalogue, on your RGS and operator network. Standard revenue-share, founding-partner terms.",
  {x:M,y:2.45,w:11.6,h:0.9,margin:0,fontFace:BODY,fontSize:18,color:P.muted,lineSpacingMultiple:1.15});
card(s,M,3.65,5.75,2.7,P.panel);
s.addText("WE BRING",{x:M+0.4,y:3.9,w:5,h:0.4,margin:0,fontFace:MONO,fontSize:12,color:P.cyan,charSpacing:2,bold:true});
s.addText([
  {text:"A differentiated, playable flagship",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Six games on one integration",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"A built-to-certify, provably-fair RGS",options:{color:P.white,bullet:{indent:14}}},
],{x:M+0.4,y:4.4,w:5,h:1.8,margin:0,fontFace:BODY,fontSize:15,lineSpacingMultiple:1.15,paraSpaceAfter:7});
card(s,M+6.15,3.65,5.75,2.7,P.panel);
s.addText("YOU BRING",{x:M+6.55,y:3.9,w:5,h:0.4,margin:0,fontFace:MONO,fontSize:12,color:P.purple,charSpacing:2,bold:true});
s.addText([
  {text:"A certified platform / RGS",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Distribution to your operator network",options:{color:P.white,bullet:{indent:14},breakLine:true}},
  {text:"Compliance + go-to-market support",options:{color:P.white,bullet:{indent:14}}},
],{x:M+6.55,y:4.4,w:5,h:1.8,margin:0,fontFace:BODY,fontSize:15,lineSpacingMultiple:1.15,paraSpaceAfter:7});
s.addText("A 30-minute call + a sandbox is all we need to align scope and timeline.",{x:M,y:6.65,w:12,h:0.4,margin:0,fontFace:BODY,fontSize:15,italic:true,color:P.muted});

/* 10 — CLOSE */
s=pres.addSlide(); bg(s);
glow(s,-1.6,-1.8,6,P.cyan,86); glow(s,9.5,4.5,7,P.purple,87); glow(s,6,-2,5,P.pink,90);
s.addText("Play it now.",{x:M,y:1.9,w:12,h:1.1,margin:0,fontFace:HEAD,fontSize:56,bold:true,color:P.white});
s.addText([
  {text:"All six games   ",options:{color:P.muted}},{text:"clutchstudios.co/play",options:{color:P.cyan,bold:true,breakLine:true}},
  {text:"Flagship   ",options:{color:P.muted}},{text:"clutch-rgs-demo.onrender.com/zenith",options:{color:P.cyan,bold:true,breakLine:true}},
  {text:"Verify fairness   ",options:{color:P.muted}},{text:"/fairness · /fairness/cross · /fairness/vault",options:{color:P.cyan,bold:true}},
],{x:M,y:3.35,w:12,h:1.6,margin:0,fontFace:MONO,fontSize:16,lineSpacingMultiple:1.5});
s.addText([{text:"CLUTCH ",options:{color:P.cyan}},{text:"STUDIOS",options:{color:P.purple}},{text:"   ·   [Founder name]   ·   team@clutchstudios.co",options:{color:P.muted}}],
  {x:M,y:5.9,w:12,h:0.5,margin:0,fontFace:HEAD,fontSize:20,bold:true});

pres.writeFile({ fileName: path.join(__dirname,"Clutch-Studios-Deck.pptx") }).then(f=>console.log("wrote",f));
