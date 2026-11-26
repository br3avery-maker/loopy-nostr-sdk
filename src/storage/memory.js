/** Storage interface: get(key), set(key,value), delete(key), keys(). */
export function memoryStore(seed={}){
  const state=new Map(Object.entries(seed).map(([k,v])=>[k,structuredClone(v)]));
  return {async get(k){return state.has(k)?structuredClone(state.get(k)):undefined},async set(k,v){state.set(k,structuredClone(v))},async delete(k){state.delete(k)},async keys(){return [...state.keys()]}};
}
