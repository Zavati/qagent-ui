const path=require('node:path');
const h=require('./observed-support.cjs');
const {compileObservedBundle}=require(path.join(process.env.QAGENT_UI_BUILD,'src/services/uiTestDesignCompiler.js'));
const contract=require(path.join(process.env.QAGENT_UI_BUILD,'src/contracts/uiTestDesign.js'));
async function fixture(options={}){
 const d=await h.fixture({environmentManaged:true,checkpoint:true,status:200,...options});
 async function replace(a,value){const b=Buffer.from(JSON.stringify(value));d.bytes.set(a.artifactId,b);a.descriptor.sha256=await h.c.sha256(new Uint8Array(b));a.descriptor.byteLength=b.length;}
 const nodes=[
  {nodeId:'node_main',parentId:null,nodeType:1,name:'main',attributes:[['data-testid','main']],text:''},
  {nodeId:'node_heading',parentId:'node_main',nodeType:1,name:'h1',attributes:[['data-testid','heading']],text:''},
  {nodeId:'node_title',parentId:'node_heading',nodeType:3,name:'#text',attributes:[],text:'Items'},
  {nodeId:'node_query',parentId:'node_main',nodeType:1,name:'input',attributes:[['id','query'],['type','search'],['name','query']],text:''},
  {nodeId:'node_active',parentId:'node_main',nodeType:1,name:'input',attributes:[['data-testid','active'],['type','checkbox']],text:''},
 ];
 await replace(d.dom,{contractVersion:'qagent.ui-dom-snapshot.v1',documentId:d.doc,nodes});
 const form=await d.artifact('FORM_STATE_JSON',{contractVersion:'qagent.ui-form-state.v1',documentId:d.doc,fields:[{nodeId:'node_query',type:'search',value:'sample',checked:false},{nodeId:'node_active',type:'checkbox',value:'on',checked:true}],scroll:[]},'uia_form');
 const layout=await d.artifact('LAYOUT_JSON',{contractVersion:'qagent.ui-layout.v1',documentId:d.doc,viewport:{width:1280,height:720,deviceScaleFactor:1,scrollX:0,scrollY:0},entries:[{nodeId:'node_query',bounds:[20,60,240,32],styles:{display:'block',color:'rgb(0, 0, 0)'}},{nodeId:'node_active',bounds:[20,120,16,16],styles:{display:'inline-block'}}]},'uia_layout');
 d.checkpoint.payload.pageCapture.formStateRef=form.artifactId;d.checkpoint.payload.pageCapture.layoutRef=layout.artifactId;
 await d.rehash();
 return {...d,base:d,form,layout,nodes,replace,async compile(profile){const assembled=await d.assemble();return compileObservedBundle(assembled.envelope,async id=>new Uint8Array(d.bytes.get(id)),profile);}};
}
module.exports={fixture,h,contract,compileObservedBundle};
