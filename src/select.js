import {icon} from './icons.js';
import './select.css';

let active=null,serial=0,typeahead='',typeTimer;
const textLabel=select=>{
 const label=select.labels?.[0];
 if(!label)return select.getAttribute('aria-label')||'Выберите вариант';
 return [...label.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent.trim()).filter(Boolean).join(' ')||select.getAttribute('aria-label')||'Выберите вариант';
};
const optionIcon=value=>({CAP:'courses',SEC:'shield',QA:'test',ARCH:'code',TE:'rocket',ALL:'subjects',UML:'subjects',GO:'code',new:'clock',active:'sparkle',done:'check',light:'sun',dark:'moon',system:'settings'}[value]||'list');

export function closeSelectMenu(focus=false){
 if(!active)return;
 const {button,menu}=active;active=null;
 clearTimeout(typeTimer);typeahead='';
 button.setAttribute('aria-expanded','false');button.removeAttribute('aria-activedescendant');menu.remove();
 if(focus&&button.isConnected)button.focus({preventScroll:true});
}
function positionMenu(){
 if(!active)return;
 const {button,menu,dialog}=active,rect=button.getBoundingClientRect();
 if(!button.isConnected)return closeSelectMenu();
 const bounds=dialog?.getBoundingClientRect(),leftEdge=bounds?bounds.left+12:12,rightEdge=bounds?bounds.right-12:innerWidth-12;
 const width=Math.min(Math.max(rect.width,active.desiredWidth),rightEdge-leftEdge);
 const below=(bounds?bounds.bottom-12:innerHeight-12)-rect.bottom-7;
 const above=rect.top-(bounds?bounds.top+12:12)-7;
 const upward=below<150&&above>below,maxHeight=Math.max(90,Math.min(330,upward?above:below));
 menu.style.width=width+'px';menu.style.maxHeight=maxHeight+'px';
 const left=Math.max(leftEdge,Math.min(rect.left,rightEdge-width));
 const height=Math.min(menu.scrollHeight,maxHeight),top=upward?rect.top-7-height:rect.bottom+7;
 menu.style.left=(dialog?left-bounds.left+dialog.scrollLeft:left)+'px';
 menu.style.top=(dialog?top-bounds.top+dialog.scrollTop:top)+'px';
 menu.dataset.direction=upward?'up':'down';
}
function highlight(index){
 if(!active||!active.options.length)return;
 active.index=(index+active.options.length)%active.options.length;
 active.options.forEach((node,i)=>{node.classList.toggle('highlighted',i===active.index);});
 const option=active.options[active.index];
 active.button.setAttribute('aria-activedescendant',option.id);
 option.scrollIntoView({block:'nearest'});
}
function choose(value){
 if(!active)return;
 const {select}=active;select.value=value;
 closeSelectMenu(true);
 select.dispatchEvent(new Event('input',{bubbles:true}));
 select.dispatchEvent(new Event('change',{bubbles:true}));
}
function listOptions(query=''){
 if(!active)return;
 const {select,list,id}=active,normalized=query.trim().toLocaleLowerCase('ru');list.replaceChildren();
 active.options=[];
 for(const [index,option]of [...select.options].entries()){
  if(option.disabled||option.hidden||normalized&&!option.textContent.toLocaleLowerCase('ru').includes(normalized))continue;
  const item=document.createElement('div');item.className='select-option';item.id=id+'-option-'+index;
  item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.dataset.selectValue=option.value;
  const glyph=document.createElement('span');glyph.className='select-option-icon';glyph.innerHTML=icon(optionIcon(option.value));
  const text=document.createElement('span');text.className='select-option-label';text.textContent=option.textContent;
  const check=document.createElement('span');check.className='select-option-check';check.innerHTML=icon('check');
  item.append(glyph,text,check);item.addEventListener('pointermove',()=>highlight(active?.options.indexOf(item)||0));
  item.addEventListener('mousedown',event=>event.preventDefault());item.addEventListener('click',()=>choose(option.value));
  list.append(item);active.options.push(item);
 }
 if(!active.options.length){const empty=document.createElement('p');empty.className='select-empty';empty.textContent='Ничего не найдено';list.append(empty);}
 active.index=Math.max(0,active.options.findIndex(option=>option.getAttribute('aria-selected')==='true'));
 positionMenu();highlight(active.index);
}
function openMenu(select,button){
 if(active?.select===select)return closeSelectMenu(true);
 closeSelectMenu();
 const menu=document.createElement('div'),id='select-menu-'+(++serial),list=document.createElement('div');
 menu.className='select-menu';list.id=id;list.className='select-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',textLabel(select));
 const dialog=select.closest('dialog');menu.style.position=dialog?'absolute':'fixed';
 const desiredWidth=Math.min(420,Math.max(180,...[...select.options].map(option=>option.textContent.length*6.5+84)));
 active={select,button,menu,list,id,dialog,desiredWidth,options:[],index:0};
 button.setAttribute('aria-controls',id);button.setAttribute('aria-expanded','true');
 if(select.options.length>10){
  const search=document.createElement('input');search.type='search';search.className='select-search';search.placeholder='Найти вариант…';search.setAttribute('aria-label','Поиск варианта');
  search.addEventListener('input',()=>listOptions(search.value));search.addEventListener('keydown',handleKey);menu.append(search);
 }
 menu.append(list);(dialog||document.body).append(menu);listOptions();
 menu.querySelector('.select-search')?.focus({preventScroll:true});
}
function handleKey(event){
 if(!active)return;
 const {key}=event;
 if(key===' '&&event.target.tagName!=='INPUT'){event.preventDefault();return active.options[active.index]&&choose(active.options[active.index].dataset.selectValue);}
 if(['ArrowDown','ArrowUp','Home','End','Enter','Escape','Tab'].includes(key)){
  if(key==='Tab'){closeSelectMenu();return;}
  event.preventDefault();
  if(key==='Escape')return closeSelectMenu(true);
  if(key==='ArrowDown')return highlight(active.index+1);
  if(key==='ArrowUp')return highlight(active.index-1);
  if(key==='Home')return highlight(0);
  if(key==='End')return highlight(active.options.length-1);
  if(key==='Enter')return active.options[active.index]&&choose(active.options[active.index].dataset.selectValue);
 }
 if(key.length===1&&!event.ctrlKey&&!event.metaKey&&event.target.tagName!=='INPUT'){
  event.preventDefault();clearTimeout(typeTimer);typeahead+=key.toLocaleLowerCase('ru');
  const found=active.options.findIndex(node=>node.textContent.trim().toLocaleLowerCase('ru').startsWith(typeahead));
  if(found>=0)highlight(found);typeTimer=setTimeout(()=>{typeahead='';},650);
 }
}
export function enhanceSelects(root=document){
 for(const select of root.querySelectorAll('select:not([data-custom-select])')){
  select.dataset.customSelect='true';select.classList.add('select-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const wrapper=document.createElement('div');wrapper.className='select-field';select.before(wrapper);wrapper.append(select);
  const button=document.createElement('button');button.type='button';button.className='select-trigger';button.dataset.selectTrigger=select.id||select.name||'field-'+(++serial);
  button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label',textLabel(select));
  const value=document.createElement('span');value.className='select-value';const chevron=document.createElement('span');chevron.className='select-chevron';chevron.innerHTML=icon('chevron');
  button.append(value,chevron);wrapper.append(button);
  const sync=()=>{value.textContent=select.selectedOptions[0]?.textContent||'Выберите вариант';button.disabled=select.disabled;};sync();select.addEventListener('change',sync);
  button.addEventListener('click',event=>{event.preventDefault();openMenu(select,button);});
  button.addEventListener('keydown',event=>{
   if(active?.select===select)return handleKey(event);
   if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){event.preventDefault();openMenu(select,button);if(event.key==='Home')highlight(0);if(event.key==='End')highlight(active.options.length-1);}
  });
 }
}
document.addEventListener('pointerdown',event=>{if(active&&!active.menu.contains(event.target)&&!active.button.contains(event.target))closeSelectMenu();});
window.addEventListener('resize',positionMenu);
document.addEventListener('scroll',event=>{if(active&&!active.menu.contains(event.target))positionMenu();},true);
