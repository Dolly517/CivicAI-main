const POOL=["a","<",">","\"","'","é","इ","😀"," ","="]; const rs=()=>Array.from({length:8},()=>POOL[Math.floor(Math.random()*POOL.length)]).join(""); const junk=()=>[null,0,"x",[],{},{issue:rs()},{address:5}][Math.floor(Math.random()*7)];
currentUser = { email: 'admin@civicai.com' }; let bad = 0;
for (let i = 0; i < 20000; i++) { safeSet(STORAGE_KEY, JSON.stringify([junk(), junk(), { id: rs(), issue: '<b>x', address: rs(), status: rs(), severity: rs() }])); try { renderAdmin(); render(); } catch (e) { bad++; if (bad < 3) console.log('admin throw:', e.message); } }
console.log('renderAdmin/render fuzz 20,000 runs, errors:', bad);
