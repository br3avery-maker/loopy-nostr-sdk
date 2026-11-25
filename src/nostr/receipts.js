/** Validate assertions from a trusted injected transport; this is not independent network verification. */
export function isVerifiedReceipt(receipt,eventId,relay){
 return receipt?.accepted===true&&receipt.readback===true&&receipt.eventId===eventId&&receipt.relay===relay;
}
export function verifiedReceipts(receipts,eventId,relays){
 const found=new Map();
 for(const r of Array.isArray(receipts?.verified)?receipts.verified:[]){
  if(relays.includes(r?.relay)&&isVerifiedReceipt(r,eventId,r.relay))found.set(r.relay,{relay:r.relay,eventId,accepted:true,readback:true});
 }
 return [...found.values()];
}
