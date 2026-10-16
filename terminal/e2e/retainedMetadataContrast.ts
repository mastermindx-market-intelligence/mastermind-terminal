import {expect,type Locator} from "@playwright/test";

export async function expectReadableMetadata(container:Locator){
 const labels=container.locator('dl dt');
 await expect(labels).toHaveCount(4);
 const contrasts=await labels.evaluateAll(nodes=>nodes.map(node=>{
  let parent:Element|null=node,background='transparent';
  while(parent){
   background=getComputedStyle(parent).backgroundColor;
   if(background!=='transparent'&&background!=='rgba(0, 0, 0, 0)')break;
   parent=parent.parentElement;
  }
  const luminance=(color:string)=>{
   if(!/^rgb\(|^color\(srgb /.test(color))throw new Error(`Unsupported color: ${color}`);
   const channels=color.match(/[\d.]+/g)!.slice(0,3).map(Number)
    .map(c=>color.startsWith('color(srgb ')?c:c/255)
    .map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
   return channels.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  };
  const a=luminance(getComputedStyle(node).color),b=luminance(background);
  return {label:node.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 }));
 for(const {label,ratio} of contrasts)expect(ratio,label??'Retained metadata').toBeGreaterThanOrEqual(4.5);
}
