/** Storage interface: get(key), set(key,value), delete(key), keys(prefix?). */
export function memoryStore(seed={}){
  const state=new Map(Object.entries(seed).map(([k,v])=>[k,structuredClone(v)]));
  return {
    async get(k){return state.has(k)?structuredClone(state.get(k)):undefined},
    async set(k,v){state.set(k,structuredClone(v))},
    async delete(k){state.delete(k)},
    async keys(prefix=''){
      const filter=typeof prefix==='string'?prefix:String(prefix??'');
      const all=[...state.keys()];
      return filter?all.filter(k=>k.startsWith(filter)):all;
    },
  };
}
