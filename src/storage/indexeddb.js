/** Browser-only IndexedDB storage with the same asynchronous interface as memoryStore. */
export function indexedDbStore({name='nsite-loopy',store='records',indexedDBProvider=globalThis.indexedDB}={}){
  if(!indexedDBProvider)throw new Error('IndexedDB not available in this host');
  const db=new Promise((resolve,reject)=>{const req=indexedDBProvider.open(name,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(store))req.result.createObjectStore(store)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  const access=(method,key,value)=>db.then(database=>new Promise((resolve,reject)=>{const txn=database.transaction(store,method==='get'||method==='getAllKeys'?'readonly':'readwrite');const obj=txn.objectStore(store);const req=method==='put'?obj.put(value,key):obj[method](key);let result;req.onsuccess=()=>{result=req.result};req.onerror=()=>reject(req.error??new Error('IndexedDB request failed'));txn.oncomplete=()=>resolve(result);txn.onabort=()=>reject(txn.error??new Error('IndexedDB transaction aborted'));txn.onerror=()=>reject(txn.error??new Error('IndexedDB transaction failed'))}));
  return {get:k=>access('get',k),set:async(k,v)=>{await access('put',k,v)},delete:async k=>{await access('delete',k)},keys:()=>access('getAllKeys')};
}
