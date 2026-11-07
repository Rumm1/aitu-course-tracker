export function cleanFilters(value={}){
 return {query:typeof value.query==='string'?value.query.slice(0,700):'',subject:typeof value.subject==='string'?value.subject.slice(0,80):'',status:['new','active','done'].includes(value.status)?value.status:'',hide:value.hide===true&&value.status!=='done',scope:value.scope==='plan'?'plan':'all',kind:['course','project','specialization','professional-certificate'].includes(value.kind)?value.kind:''};
}
export function readFilters(storage,key){try{return cleanFilters(JSON.parse(storage.getItem(key)||'{}')||{});}catch{return cleanFilters();}}
