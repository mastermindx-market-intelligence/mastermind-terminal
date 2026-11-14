"""Offline vector compositions, not HTML screenshots or native Paper exports.

All data is illustrative. Rendering stays local and performs no network access.
The compositions establish hierarchy, density and the proposed visual language.
"""
from pathlib import Path
import json, math, html, textwrap
import fitz
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'compositions'
OUT.mkdir(exist_ok=True)
D=json.loads((ROOT/'evidence/composition_data.json').read_text())
COLORS={
 'dark':dict(bg='#0b1017',panel='#111821',raised='#19232e',line='#293441',text='#ecf1f7',secondary='#a8b6c8',muted='#8798ac',accent='#79a9fa',compare='#6d7e94',up='#75c7a6',down='#e99898',warn='#e2ba7a'),
 'light':dict(bg='#f4f6f9',panel='#ffffff',raised='#eaf0f6',line='#d5dfe9',text='#172536',secondary='#485d75',muted='#60758d',accent='#285cb3',compare='#8293a7',up='#24765a',down='#aa4448',warn='#89601e')}
NAMES={p['id']:p['name'] for p in D['PAGES']}
SHORT={p['id']:p['short'] for p in D['PAGES']}
HEAD={'crypto':'Leadership is broadening.','bitcoin':'Trend holds. Leverage disagrees.','record':'Smoother, with lower return.','commodities':'Metals lead. Energy splits.','strategies':'Test the thesis.','reserves':'A rebuilding buffer.','forex':'Dollar weakens. Drivers differ.','bonds':'Long yields move higher.'}
NOTES={'crypto':'See which moves have participation behind them.','bitcoin':'Follow the price and keep the contradiction in view.','record':'Compare return, drawdown and decisions over matching dates.','commodities':'Compare the moves, then examine the physical evidence.','strategies':'What supports it, what would break it, and what the record shows.','reserves':'Separate stored oil from announced purchases and releases.','forex':'Separate the dollar move from the pair’s own drivers.','bonds':'Connect the curve move to a specific exposure.'}
TABS={'crypto':['Overview','Flows','Leverage','Market board'],'bitcoin':['Overview','Cycle','Derivatives','History'],'record':['Performance','Decisions','Assumptions'],'commodities':['Overview','Explore','Relationships','Compare','Research note'],'strategies':['Workspace','Conditions','Compare models'],'reserves':['Stock history','Release ledger','Country context'],'forex':['Pair workspace','Cross-currency','Carry & exposure','Research note'],'bonds':['Yield curves','Credit','Transmission']}
def signed(x,n=1):return ('+' if x>=0 else '−')+f'{abs(x):.{n}f}'
def curve(n,start,end,wiggle=.04,phase=0):
 return [start*(end/start)**(i/(n-1))*(1+math.sin(math.pi*i/(n-1))*wiggle*(.6*math.sin(i/(n-1)*14*math.pi+phase)+.7*math.sin(i/(n-1)*5*math.pi-phase))) for i in range(n)]
def price_series(end,ret,wiggle=.05,phase=0):
 before=end/(1+ret/100)
 return curve(101,before*.88,before,wiggle,phase)+curve(21,before,end,wiggle*.28,phase)[1:]

def maxdd(a):
 peak=a[0];dd=0
 for x in a:peak=max(peak,x);dd=min(dd,x/peak-1)
 return dd*100

class Board:
 def __init__(self,page,theme='dark',mobile=False,title=None):
  self.page=page;self.theme=theme;self.c=COLORS[theme];self.mobile=mobile;self.w=390 if mobile else 1440;self.h=1250 if mobile else 1000;self.a=[];self.title=title or NAMES[page]
  self.rect(0,0,self.w,self.h,'bg',0)
 def rect(self,x,y,w,h,fill='panel',r=12,stroke=None,opacity=1):
  color=self.c.get(fill,fill);st=self.c.get(stroke,stroke) if stroke else None
  self.a.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{color}" opacity="{opacity}"'+(f' stroke="{st}"' if st else '')+'/>')
 def line(self,x1,y1,x2,y2,c='line',width=1,dash=None):
  self.a.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{self.c.get(c,c)}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
 def text(self,x,y,t,size=14,c='text',weight=400,anchor='start',spacing=None):
  self.a.append(f'<text x="{x}" y="{y}" fill="{self.c.get(c,c)}" font-size="{size}" font-family="Arial, sans-serif" font-weight="{weight}" text-anchor="{anchor}"'+(f' letter-spacing="{spacing}"' if spacing else '')+'>'+html.escape(str(t))+'</text>')
 def wrap(self,x,y,t,width,size=13,c='secondary',lineh=20,maxlines=4):
  lines=textwrap.wrap(t,width=max(10,int(width/(size*.53))))[:maxlines]
  for i,l in enumerate(lines):self.text(x,y+i*lineh,l,size,c)
  return len(lines)*lineh
 def pill(self,x,y,t,active=False):
  w=len(t)*6.3+22;self.rect(x,y,w,29,'raised' if active else 'panel',7,'line');self.text(x+11,y+19,t,11,'text' if active else 'secondary',500);return w
 def button(self,x,y,w,t,primary=False):
  self.rect(x,y,w,39,'raised',7,'line');self.text(x+13,y+25,t,12,'accent' if primary else 'text',500);self.text(x+w-15,y+25,'›',17,'accent' if primary else 'secondary','400','end')
 def panel(self,x,y,w,h,title=None,sub=None):
  self.rect(x,y,w,h,'panel',12,'line')
  if title:self.text(x+24,y+32,title,16,'text',600)
  if sub:self.text(x+24,y+54,sub,11,'muted')
 def stat(self,x,y,label,value,sub='',color='text',size=28):
  self.text(x,y,label,11,'muted');self.text(x,y+34,value,size,color,500)
  if sub:self.text(x,y+55,sub,11,'muted')
 def legend(self,x,y,items):
  for name,col in items:
   self.line(x,y-4,x+17,y-4,col,2);self.text(x+25,y,name,11,'secondary');x+=len(name)*6.4+49
 def chart(self,x,y,w,h,series,labels=None,unit='',area=True,ymin=None,ymax=None):
  data=[v for _,vals,_ in series for v in vals];lo=min(data) if ymin is None else ymin;hi=max(data) if ymax is None else ymax;pad=(hi-lo)*.15 or 1;lo-=pad if ymin is None else 0;hi+=pad if ymax is None else 0
  pw=w-58;ph=h-28;py=lambda v:y+(hi-v)/(hi-lo)*ph
  for i in range(5):
   v=lo+(hi-lo)*i/4;yy=py(v);self.line(x,yy,x+pw,yy,'line',.7)
   label=f'{v:.5f}' if abs(v)<.1 else f'{v:.2f}' if abs(v)<10 else f'{v:,.0f}'
   self.text(x+pw+10,yy+4,label+unit,10 if not self.mobile else 11,'muted')
  for k,(name,vals,col) in enumerate(series):
   points=[(x+i/(len(vals)-1)*pw,py(v)) for i,v in enumerate(vals)]
   p=' '.join(('M' if i==0 else 'L')+f'{a:.2f},{b:.2f}' for i,(a,b) in enumerate(points))
   if k==0 and area:self.a.append(f'<path d="{p} L{x+pw},{y+ph} L{x},{y+ph} Z" fill="{self.c[col]}" opacity=".07"/>')
   self.a.append(f'<path d="{p}" fill="none" stroke="{self.c[col]}" stroke-width="{2.3 if k==0 else 1.6}"'+(' stroke-dasharray="5 5"' if k else '')+'/>')
   a,b=points[-1];self.a.append(f'<circle cx="{a}" cy="{b}" r="3" fill="{self.c[col]}"/>')
  labels=labels or ['Jan','Feb','Mar','Apr','May','Jun']
  for i,t in enumerate(labels):
   if self.mobile and len(labels)>6 and i not in [0,3,4,6,len(labels)-2,len(labels)-1]:continue
   self.text(x+i/(len(labels)-1)*pw,y+h,t,10 if not self.mobile else 11,'muted',anchor='start' if i==0 else 'end' if i>=len(labels)-(2 if self.mobile and len(labels)>6 else 1) else 'middle')
 def hint(self,x,y,title,state,description,w=286,color='secondary'):
  self.text(x,y,title,13,'text',500);self.text(x+w,y,state,12,color,anchor='end');self.wrap(x,y+25,description,w,12,'muted',18)
 def chrome(self,active=None):
  p=self.page
  if self.mobile:
   self.rect(0,0,390,56,'panel',0);self.text(20,35,'M',22,'accent',600);self.text(51,34,'Mastermind',16,'text',600);self.text(324,34,'⌕',22,'secondary');self.text(362,33,'○',20,'secondary');self.line(0,56,390,56)
   self.text(20,88,'Other Assets',12,'muted');self.text(370,88,SHORT[p]+'  ▾',12,'text',500,'end')
   self.text(20,136,NAMES[p],25,'text',600);self.text(20,160,'30 Jun 2025 · Illustrative',11,'muted')
   x=20
   for i,t in enumerate(TABS[p][:3]):
    w=self.pill(x,184,t,i==0);x+=w+6
   self.text(20,256,'Trend and leverage diverge.' if p=='bitcoin' else HEAD[p],24,'text',500);self.wrap(20,282,NOTES[p],350,13,lineh=20,maxlines=2)
  else:
   self.rect(0,0,1440,58,'panel',0);self.text(23,37,'M',26,'accent',600);self.text(62,35,'Mastermind',17,'text',600);self.text(230,35,'Markets  /  Other Assets',12,'muted')
   self.rect(1016,13,265,32,'raised',7,'line');self.text(1032,34,'⌕   Find a workspace',12,'muted');self.text(1265,34,'⌘ K',11,'muted',anchor='end');self.text(1314,36,'☼',20,'secondary');self.text(1355,35,'?',17,'secondary');self.rect(1384,15,28,28,'raised',14);self.text(1398,34,'RL',10,'text',500,'middle')
   self.line(0,58,1440,58);self.rect(0,58,64,915,'panel',0);self.line(64,58,64,973)
   for i,mark in enumerate(['▦','↗','⌕']):
    if i==1:self.rect(12,126,40,40,'raised',9)
    self.text(32,103+i*52,mark,22,'accent' if i==1 else 'muted',anchor='middle')
   self.text(32,934,'⚙',20,'muted',anchor='middle')
   x=100
   for q in D['PAGES']:
    w=len(q['short'])*7+30
    if q['id']==p:self.rect(x-11,69,w,34,'raised',7)
    self.text(x,91,q['short'],12,'text' if q['id']==p else 'muted',500 if q['id']==p else 400);x+=w+20
   self.line(64,113,1440,113)
   self.text(100,164,NAMES[p],28,'text',600);self.text(100,190,'30 Jun 2025 · Illustrative research workspace',12,'muted')
   self.button(1112,146,101,'Sources');self.button(1225,146,115,'Copy view')
   x=100
   for i,t in enumerate(TABS[p]):x+=self.pill(x,214,t,t==(active or TABS[p][0]))+9
   self.text(100,292,HEAD[p],32,'text',500);self.text(100,321,NOTES[p],13,'secondary')
  fy=self.h-27;self.rect(0,fy,self.w,27,'panel',0);self.line(0,fy,self.w,fy)
  self.text(20,fy+18,'DESIGN COMPOSITION  ·  ILLUSTRATIVE DATA',9,'muted',500)
  if not self.mobile:self.text(1420,fy+18,'Not applied to Paper  ·  Not an HTML screenshot',10,'muted',anchor='end')
 def save(self,name):
  svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" role="img"><title>{html.escape(self.title)}</title><desc>Static design composition. All numbers are illustrative. Not a browser screenshot or native Paper export.</desc>'+''.join(self.a)+'</svg>'
  f=OUT/(name+'.svg');f.write_text(svg)
  doc=fitz.open(stream=svg.encode(),filetype='svg');pix=doc[0].get_pixmap(matrix=fitz.Matrix(1,1),alpha=False);pix.save(OUT/(name+'.png'));doc.close()
  return f

def market_table(b,y=810):
 b.panel(100,y,1240,144,'Market board')
 b.text(1320,y+32,'Inspect every asset  ›',11,'accent',anchor='end')
 for x,t in [(124,'Asset'),(530,'1M return'),(715,'Relative to BTC'),(975,'Market state'),(1195,'Leverage')]:b.text(x,y+60,t,10,'muted')
 for i,a in enumerate(D['CRYPTO'][:2]):
  yy=y+88+i*34;b.line(124,yy-16,1316,yy-16);b.text(124,yy,a['name'],12,'text',500);b.text(252,yy,a['id'],11,'muted');b.text(530,yy,signed(a['ret'])+'%',12,'up');b.text(715,yy,signed(a['relative'])+'%',12,'up' if a['relative']>=0 else 'down');b.text(975,yy,a['trend'],12,'secondary');b.text(1195,yy,a['lev'],12,'warn' if a['lev']=='Elevated' else 'secondary');b.text(1315,yy,'›',17,'muted')

def desktop(page,theme='dark',variant=None):
 b=Board(page,theme,title=NAMES[page]+(' · '+variant if variant else ''));b.chrome('Cross-currency' if variant=='matrix' else 'Compare' if variant=='compare' else None)
 x,y,w,h=100,354,880,430;sx,sw=1000,340
 if page=='crypto':
  b.stat(1024,275,'Breadth · above 50-day trend','68%','34 of 50 assets');b.stat(1220,275,'Fund flows · 7 days','+$420m','Net subscriptions','up')
  b.panel(x,y,w,h,'Bitcoin versus the crypto market','Bitcoin and the market · rebased to 100')
  b.text(124,455,'$104,820.00',32,'text',500);b.text(355,453,'+12.4%  1M',13,'up')
  b.pill(818,376,'6M',True);b.chart(124,480,832,233,[('Bitcoin',D['BENCH'],'accent'),('Market',curve(121,100,119.7,.045,2),'compare')]);b.legend(124,751,[('Bitcoin','accent'),('Crypto market','compare')]);b.text(954,751,'Source & method',11,'accent',anchor='end')
  b.panel(sx,y,sw,h,'Under the move')
  b.hint(1024,433,'Participation','Broadening','Strength is extending beyond Bitcoin.',292,'up');b.line(1024,498,1316,498)
  b.hint(1024,530,'Spot demand','Supporting','Net fund subscriptions remain positive.',292,'up');b.text(1024,588,'Inspect flows  ›',12,'accent');b.line(1024,613,1316,613)
  b.hint(1024,646,'Derivatives','More crowded','Funding and open interest have risen together.',292,'warn');b.text(1024,716,'Inspect leverage  ›',12,'accent');market_table(b)
 elif page=='bitcoin':
  b.panel(x,y,w,475,'One price. Different drivers.','BTC / USD · original decision records')
  b.text(124,452,'$104,820.00',32,'text',500);b.text(355,450,'+12.4%  1M',13,'up');b.chart(124,475,832,201,[('Bitcoin',[v/141.1*104820 for v in D['BENCH']],'accent')])
  for i,(lab,state,col) in enumerate([('Price trend','Rising','accent'),('Spot demand','Supporting','accent'),('Leverage','Elevated','warn')]):
   yy=711+i*31;b.text(124,yy,lab,11,'secondary')
   for j in range(38):b.rect(254+j*13,yy-13,8,8+(j*7+i)%10,col,1,opacity=.24+(j%6)*.08)
   b.text(952,yy,state,11,'warn' if i==2 else 'secondary',anchor='end')
  b.panel(sx,y,sw,217,'Model allocation');b.text(1024,451,'45%',54,'text',500);b.text(1154,449,'Bitcoin',13,'secondary');b.rect(1024,476,292,7,'raised',3);b.rect(1024,476,131.4,7,'accent',3);b.text(1024,510,'Model capital',11,'muted');b.text(1316,510,'55% cash',11,'muted',anchor='end');b.text(1024,544,'Separate from your account holdings.',12,'secondary')
  b.panel(sx,591,sw,238,'What changes the read');b.hint(1024,666,'Spot demand fades','','Inspect the qualified demand observation.');b.line(1024,711,1316,711);b.hint(1024,744,'Leverage keeps building','','Check whether positioning outruns participation.')
  b.panel(100,850,1240,104);b.text(124,885,'Review history',13,'text',500);b.line(285,881,1050,881,'line',4);b.line(285,881,950,881,'accent',4);b.rect(944,874,14,14,'accent',7);b.text(285,914,'Jan 2025',11,'muted');b.text(1050,914,'30 Jun',11,'muted',anchor='end');b.button(1115,871,201,'Latest evidence  ↗')
 elif page=='record':
  for xx,lab,val,sub,col in [(100,'Model return · net','+28.4%','Simulated model','up'),(370,'Worst drawdown',signed(maxdd(D['MODEL']))+'%','Peak to trough','down'),(640,'Versus Bitcoin','−12.7 pp','Matching dates','down'),(910,'Benchmark return','+41.1%','BTC buy-and-hold','up')]:b.stat(xx,365,lab,val,sub,col)
  b.panel(100,449,880,365,'Growth of 100','USD · net model return · matched start date');b.chart(124,530,832,205,[('Model',D['MODEL'],'accent'),('Bitcoin',D['BENCH'],'compare')]);b.legend(124,777,[('Model','accent'),('Bitcoin','compare')]);b.text(954,777,'Inspect a period  ↔',11,'accent',anchor='end')
  b.panel(1000,449,340,365,'Read the trade-off');b.hint(1024,530,'Return','−12.7 pp','Bitcoin finished higher over the same window.',292,'down');b.line(1024,595,1316,595);b.hint(1024,630,'Drawdown',f'{abs(maxdd(D["MODEL"])):.1f}%','Inspect the deepest decline before comparing the recovery.');b.button(1024,735,292,'Costs & assumptions')
  b.panel(100,835,1240,119,'Decision ledger','Original version and inputs remain attached')
  b.text(124,922,'12 Jun',11,'muted');b.text(230,922,'Exposure reduced',13,'text',500);b.text(505,922,'Leverage condition weakened',12,'secondary');b.text(1190,922,'60% → 45%',13,'text');b.text(1316,922,'›',18,'muted',anchor='end')
 elif page=='commodities':
  b.stat(1147,275,'Markets higher · 1M','11 of 17','Matching observation window')
  b.panel(100,354,880,600,'Across the complex','One month · one return scale · each market keeps its own price unit')
  families=list(dict.fromkeys(a['fam'] for a in D['COMMODITIES']))
  for i,fam in enumerate(families):
   fx=124+(i%3)*278;fy=452+(i//3)*235;b.text(fx,fy,fam.upper(),10,'muted',600,spacing='.8')
   for j,a in enumerate(z for z in D['COMMODITIES'] if z['fam']==fam):
    yy=fy+38+j*53
    if a['id']=='copper':b.rect(fx-9,yy-22,254,49,'raised',7)
    b.text(fx,yy,a['name'],12,'text',500);b.text(fx+232,yy,signed(a['ret'])+'%',12,'up' if a['ret']>=0 else 'down',anchor='end');center=fx+117;b.line(center,yy+8,center,yy+22);bw=abs(a['ret'])/12.6*106;b.rect(center if a['ret']>=0 else center-bw,yy+13,bw,6,'up' if a['ret']>=0 else 'down',2)
  b.panel(1000,354,340,600,'Selected market');b.text(1024,445,'Copper',28,'text',600);b.text(1024,490,'4.72',38,'text',500);b.text(1122,489,'USD / lb',12,'muted');b.text(1024,520,'+8.1%  1M',13,'up');b.chart(1024,554,292,112,[('Copper',curve(40,4.2,4.72,.06),'accent')],labels=['Apr','May','Jun']);b.line(1024,699,1316,699);b.hint(1024,732,'Price trend','Rising','Physical confirmation needs its own evidence.');b.hint(1024,819,'Inventory context','Inspect','Each stock measure keeps its release date.');b.button(1024,890,292,'Explore Copper',True)
 elif page=='strategies':
  b.panel(100,354,220,600)
  for i,a in enumerate(D['STRATEGIES']):
   yy=375+i*165
   if i==0:b.rect(112,yy,196,145,'raised',8,'line')
   b.text(128,yy+28,a['asset'].upper(),10,'muted',600);b.text(128,yy+59,a['name'],18,'text',600);b.text(128,yy+84,a['state'],11,'secondary');b.pill(128,yy+102,'Backtest');b.text(290,yy+121,signed(a['ret'])+'%',13,'up',anchor='end')
  b.panel(340,354,640,600,'Gold · Trend swap','Backtested model · separate from account returns');b.stat(364,454,'Illustrative return','+14.8%','','up',27);b.stat(625,454,'Worst drawdown',signed(maxdd(curve(100,100,114.8,.055,1)))+'%','','down',27)
  b.chart(364,515,592,197,[('Model',curve(100,100,114.8,.055,1),'accent'),('Underlying',curve(100,100,119.4,.13,2),'compare')]);b.legend(364,754,[('Model','accent'),('Underlying','compare')]);b.line(364,782,956,782);b.text(364,809,'HYPOTHETICAL SENSITIVITY',10,'warn',600);b.text(364,845,'Cost per rebalance',12,'secondary');b.text(650,845,'8 bp',12,'text',anchor='end');b.line(364,866,650,866,'line',4);b.rect(440,860,12,12,'accent',6);b.text(364,909,'Roll contribution',12,'secondary');b.text(650,909,'−1.5 pp',12,'text',anchor='end');b.stat(731,845,'Net sensitivity','+12.3%','12 rebalances','up',28)
  b.panel(1000,354,340,600,'Thesis conditions')
  for i,(title,desc) in enumerate([('Trend remains constructive','Inspect the trend and its invalidation level.'),('Physical evidence supports it','Open the underlying dated observation.'),('Costs stay within the test','Reassess when implementation assumptions change.'),('Invalidation is explicit','A failed condition opens the evidence and original test.')]):
   yy=436+i*110;b.text(1024,yy,'✓' if i<2 else '○',15,'secondary');b.text(1049,yy,title,12,'text',500);b.wrap(1049,yy+25,desc,264,12,'muted',18)
 elif page=='reserves':
  b.panel(100,354,880,430,'United States','Strategic petroleum reserve · reported stock')
  b.text(124,449,'STOCK / AUTHORIZED CAPACITY',10,'muted',600);b.text(956,449,'+3.2m latest change',12,'up',anchor='end');b.rect(124,468,832,72,'raised',12,'line');b.rect(125,469,830*(402.4/714),70,'accent',11,opacity=.2)
  for i in range(1,10):b.line(124+i*83.2,469,124+i*83.2,538,'line')
  b.text(144,515,'402.4',35,'text',500);b.text(260,514,'million barrels',13,'secondary');b.text(124,564,'56.4% of authorized capacity',11,'muted');b.text(956,564,'714m barrels',11,'muted',anchor='end');b.chart(124,591,832,139,[('Stock',curve(80,365.6,402.4,.02,1),'accent')],labels=['Jan','Feb','Mar','Apr','May','Jun']);b.text(956,760,'Definition & vintage',11,'accent',anchor='end')
  b.panel(1000,354,340,430,'What can it cover?');b.pill(1024,416,'Net imports',True);b.pill(1145,416,'Consumption');b.text(1024,510,'126',52,'text',500);b.text(1137,509,'days',16,'secondary');b.wrap(1024,545,'Stock divided by 3.2m barrels per day.',292,12,'muted');b.line(1024,589,1316,589);b.wrap(1024,626,'Arithmetic coverage. Deliverability, composition and usable volume are separate questions.',292,13);b.button(1024,716,292,'Inspect the denominator')
  b.panel(100,805,1240,149,'Release & refill ledger')
  for i,(date,title,desc,v) in enumerate([('27 Jun','Stock estimate revised','401.8m → 402.4m','+0.6m'),('20 Jun','Refill delivered','Recorded addition to strategic stocks','+3.2m')]):
   yy=878+i*42;b.line(124,yy-23,1316,yy-23);b.text(124,yy,date,11,'muted');b.text(230,yy,title,13,'text',500);b.text(580,yy,desc,12,'secondary');b.text(1260,yy,v,13,'text',anchor='end');b.text(1316,yy,'›',18,'muted',anchor='end')
 elif page=='forex':
  b.panel(100,354,265,422,'Against the dollar','One month · spot return')
  for i,c in enumerate(D['CURRENCIES'][:-1]):
   yy=454+i*43;b.text(124,yy,c['id'],12,'accent' if i==0 else 'secondary',500);b.rect(174,yy-7,103,5,'raised',3);b.rect(174,yy-7,abs(c['ret'])/2.4*103,5,'up' if c['ret']>=0 else 'down',3);b.text(341,yy,signed(c['ret'])+'%',12,'up' if c['ret']>=0 else 'down',anchor='end')
  b.panel(385,354,955,422,'Selected pair','USD per one EUR');b.text(409,458,'EUR / USD',25,'text',600);b.pill(586,434,'⇄');b.text(1316,458,'1.1740',34,'text',500,'end');b.text(1316,487,'+2.40%  1M',13,'up',anchor='end');b.chart(409,510,907,198,[('Pair',price_series(1.174,2.4,.015,1),'accent')]);b.text(1316,750,'Quote & source',11,'accent',anchor='end')
  b.panel(100,798,610,156,'Pair drivers');b.text(124,870,'Spot trend',12,'secondary');b.text(686,870,'Rising',12,'text',500,'end');b.text(124,911,'Two-year gap · EUR minus USD',12,'secondary');b.text(686,911,'−140 bp',13,'text',500,'end')
  b.panel(730,798,610,156,'Carry & exposure');b.wrap(754,870,'The interest-rate gap does not equal the return. Add spot, funding and any hedge.',475,13);b.text(1316,925,'Inspect the payoff  ›',12,'accent',anchor='end')
 elif page=='bonds':
  b.stat(1040,275,'10-year par yield','4.25%','Illustrative curve');b.stat(1220,275,'2s10s slope','+36 bp','10Y minus 2Y')
  b.panel(100,354,880,600,'US Treasury curve','Par yields · two-date comparison')
  for i,t in enumerate(['2Y','5Y','10Y','30Y']):b.pill(124+i*62,429,t,t=='10Y')
  now=D['CURVE_NOW'];old=D['CURVE_OLD'];b.chart(124,486,832,240,[('30 Jun',now,'accent'),('23 Jun',old,'compare')],D['TENORS'],unit='%',area=False);b.legend(124,765,[('30 Jun','accent'),('23 Jun','compare')]);b.text(124,810,'OBSERVED CHANGE · 23–30 JUN · BP',10,'muted',600)
  for i,(ten,a,z) in enumerate(zip(D['TENORS'],now,old)):
   xx=148+i*79;v=(a-z)*100;b.line(xx-12,888,xx+28,888,'line');b.rect(xx-4,888-max(0,v*2.2),22,max(1,abs(v)*2.2),'up' if v>=0 else 'down',2);b.text(xx+7,909,ten,10,'muted',anchor='middle');b.text(xx+7,842,signed(v,0),11,'up' if v>=0 else 'down',anchor='middle')
  b.panel(1000,354,340,211,'10Y Treasury','Observed par yield');b.text(1024,467,'4.25%',44,'text',500);b.text(1190,465,'+13 bp',13,'up');b.wrap(1024,507,'The price effect depends on the instrument and horizon.',292,12,'secondary')
  b.panel(1000,585,340,369,'Sample exposure');b.pill(1216,606,'Hypothetical');b.stat(1024,673,'Position','$10k','','text',24);b.stat(1127,673,'Mod. duration','5.8','','text',24);b.stat(1224,673,'Convexity','42','','text',24);b.text(1024,760,'Parallel yield shift',12,'secondary');b.text(1316,760,'+50 bp',12,'text',anchor='end');b.line(1024,785,1316,785,'line',4);b.rect(1234,778,14,14,'accent',7);b.rect(1024,814,292,77,'raised',8);b.text(1040,840,'Estimated price change',11,'secondary');b.text(1298,872,'−$284.75',27,'down',500,'end');b.text(1024,925,'Assumptions & limits  ›',12,'accent')
 return b

def mobile(page):
 b=Board(page,mobile=True);b.chrome();x,y,w=20,341,350
 def plot_panel(title,sub,values,second=None,unit='',labels=None):
  b.panel(x,y,w,364,title,sub);b.chart(40,y+106,310,205,values,labels=labels or ['Jan','Mar','May','Jun'],unit=unit);b.legend(40,y+341,[(v[0],v[2]) for v in values]) if len(values)>1 else b.text(348,y+341,'Source & method',11,'accent',anchor='end')
 if page=='crypto':
  plot_panel('Participation follows price','Bitcoin · rebased to 100',[('BTC',D['BENCH'],'accent'),('Market',curve(80,100,119.7,.04,2),'compare')]);b.text(40,427,'+12.4%  1M',18,'up',500)
  b.panel(20,726,350,281,'Under the move');b.hint(40,800,'Participation','Broadening','34 of 50 assets above their 50-day trend.',310,'up');b.line(40,859,350,859);b.hint(40,890,'Derivatives','More crowded','Inspect funding and open interest.',310,'warn');b.button(40,949,310,'Open the market board',True)
 elif page=='bitcoin':
  plot_panel('One price. Different drivers.','BTC / USD · original records',[('BTC',[v/141.1*104820 for v in D['BENCH']],'accent')]);b.text(40,428,'$104,820',27,'text',500)
  b.panel(20,726,350,279,'Model allocation');b.text(40,829,'45%',46,'text',500);b.text(155,827,'Bitcoin',13,'secondary');b.rect(40,855,310,7,'raised',3);b.rect(40,855,139.5,7,'accent',3);b.text(40,887,'Model target · separate from holdings',11,'muted');b.button(40,929,310,'Review history',True)
 elif page=='record':
  plot_panel('Growth of 100','Simulated · net · same dates',[('Model',D['MODEL'],'accent'),('Bitcoin',D['BENCH'],'compare')]);b.text(40,428,'+28.4%',27,'up',500);b.text(350,426,'−12.7 pp vs BTC',11,'secondary',anchor='end')
  b.panel(20,726,350,279,'Read the trade-off');b.stat(40,804,'Worst drawdown',signed(maxdd(D['MODEL']))+'%','Selected window','down',30);b.wrap(40,888,'Inspect the decisions inside the decline before comparing the recovery.',310,13);b.button(40,946,310,'Open the decision ledger',True)
 elif page=='commodities':
  b.panel(20,341,350,482,'Across the complex','One month · shared zero and scale')
  rows=[D['COMMODITIES'][i] for i in [0,1,6,3,4,5]]
  for i,a in enumerate(rows):
   yy=437+i*58
   if a['id']=='copper':b.rect(32,yy-24,326,52,'raised',7)
   b.text(40,yy,a['name'],13,'text',500);b.text(350,yy,signed(a['ret'])+'%',13,'up' if a['ret']>=0 else 'down',anchor='end');b.line(195,yy+10,195,yy+24);bw=abs(a['ret'])/12.6*140;b.rect(195 if a['ret']>=0 else 195-bw,yy+15,bw,6,'up' if a['ret']>=0 else 'down',2)
  b.text(350,797,'All 17 markets  ›',12,'accent',anchor='end');b.panel(20,844,350,260,'Selected · Copper');b.stat(40,927,'Price','4.72','USD / lb','text',34);b.text(350,961,'+8.1%  1M',13,'up',anchor='end');b.button(40,1040,310,'Explore physical evidence',True)
 elif page=='strategies':
  plot_panel('Gold · Trend swap','Backtest · matching evaluation sample',[('Model',curve(100,100,114.8,.055,1),'accent'),('Underlying',curve(100,100,119.4,.13,2),'compare')]);b.text(40,428,'+14.8%',27,'up',500)
  b.panel(20,726,350,326,'Thesis conditions')
  for i,(title,desc) in enumerate([('Trend holds','Inspect its invalidation level.'),('Physical support persists','Open the dated observation.'),('Costs remain qualified','Keep the original assumptions.')]):b.hint(40,802+i*76,title,'',desc,310)
  b.button(40,1090,310,'Test cost & roll sensitivity',True)
 elif page=='reserves':
  b.panel(20,341,350,369,'United States','Strategic stock · reported');b.rect(40,427,310,70,'raised',10,'line');b.rect(41,428,308*402.4/714,68,'accent',9,opacity=.2);b.text(54,474,'402.4m',34,'text',500);b.text(40,524,'56.4% of authorized capacity',11,'muted');b.chart(40,550,310,112,[('Stock',curve(80,365.6,402.4,.02,1),'accent')],['Jan','Mar','May','Jun'])
  b.panel(20,731,350,294,'What can it cover?');b.pill(40,793,'Net imports',True);b.pill(165,793,'Consumption');b.text(40,886,'126',50,'text',500);b.text(154,884,'days',15,'secondary');b.wrap(40,922,'Stock divided by 3.2m barrels per day. Deliverability remains separate.',310,12);b.button(40,969,310,'Inspect the denominator')
 elif page=='forex':
  plot_panel('EUR / USD','USD per 1 EUR',[('Pair',price_series(1.174,2.4,.015,1),'accent')]);b.text(40,428,'1.1740',28,'text',500);b.text(350,428,'+2.40%  1M',12,'up',anchor='end')
  b.panel(20,726,350,296,'Against the dollar','One month · spot returns')
  for i,c in enumerate(D['CURRENCIES'][:4]):
   yy=823+i*41;b.text(40,yy,c['id'],12,'secondary');b.rect(105,yy-7,abs(c['ret'])/2.4*154,5,'up',2);b.text(350,yy,signed(c['ret'])+'%',12,'up',anchor='end')
  b.button(40,1061,310,'Carry & exposure',True)
 elif page=='bonds':
  plot_panel('US Treasury curve','Par yields · 23–30 Jun',[('30 Jun',D['CURVE_NOW'],'accent'),('23 Jun',D['CURVE_OLD'],'compare')],unit='%',labels=D['TENORS']);b.text(40,428,'4.25%',28,'text',500);b.text(350,426,'10Y · +13 bp',12,'secondary',anchor='end')
  b.panel(20,726,350,316,'Sample exposure');b.pill(241,745,'Hypothetical');b.stat(40,813,'Position','$10k','','text',23);b.stat(146,813,'Mod. duration','5.8','','text',23);b.stat(252,813,'Convexity','42','','text',23);b.text(40,900,'Parallel shift',12,'secondary');b.text(350,900,'+50 bp',12,'text',anchor='end');b.line(40,925,350,925,'line',4);b.rect(265,918,14,14,'accent',7);b.text(40,988,'Estimated price change',11,'muted');b.text(350,1015,'−$284.75',28,'down',500,'end')
 return b

def interaction_boards():
 # A native Paper implementation will express these as separate editable state boards.
 b=desktop('bitcoin');b.rect(100,174,600,27,'bg',0);b.text(100,190,'28 Apr 2025 · Historical illustrative snapshot',12,'muted');b.rect(283,870,772,34,'panel',0);b.line(285,881,1050,881,'line',4);b.line(285,881,782,881,'accent',4);b.rect(775,874,14,14,'accent',7);b.button(1115,871,201,'Return to latest');b.rect(100,263,880,74,'bg',0);b.text(100,292,'Historical evidence, preserved.',32,'text',500);b.text(100,321,'28 Apr 2025 · the complete snapshot moves with the selected record.',13,'secondary');b.rect(1017,411,306,143,'panel',0);b.text(1024,451,'35%',54,'text',500);b.text(1154,449,'Bitcoin',13,'secondary');b.rect(1024,476,292,7,'raised',3);b.rect(1024,476,102.2,7,'accent',3);b.text(1024,510,'Model capital',11,'muted');b.text(1316,510,'65% cash',11,'muted',anchor='end');b.text(1024,544,'Historical model target · original vintage',11,'secondary');b.rect(112,415,856,383,'panel',0);b.text(124,452,'Historical price record',27,'text',500);b.chart(124,480,832,195,[('BTC',[v/141.1*104820 for v in D['BENCH'][:79]],'accent')],['Jan','Feb','Mar','28 Apr']);
 for i,(lab,state) in enumerate([('Price trend','Recovering'),('Spot demand','Improving'),('Leverage','Neutral')]):b.text(124,716+i*31,lab,11,'secondary');b.text(954,716+i*31,state,11,'secondary',anchor='end')
 b.save('09_Bitcoin_Historical_Snapshot')
 b=desktop('commodities',variant='compare');b.rect(100,354,1240,600,'bg',0);b.panel(100,354,880,600,'Compare like with like','One-month returns · up to four markets')
 for i,a in enumerate([D['COMMODITIES'][0],D['COMMODITIES'][3],D['COMMODITIES'][6],D['COMMODITIES'][1]]):
  yy=493+i*99;b.pill(124+i*150,429,a['name'],True);b.text(124,yy,a['name'],14,'text',500);center=575;b.line(center,yy-20,center,yy+18);bw=abs(a['ret'])/12.6*290;b.rect(center if a['ret']>=0 else center-bw,yy-8,bw,14,'up' if a['ret']>=0 else 'down',3);b.text(954,yy,signed(a['ret'])+'%',16,'up' if a['ret']>=0 else 'down',anchor='end')
 b.panel(1000,354,340,600,'Comparison basis');b.hint(1024,437,'Window','1 month','Publisher month is different from 20 trading sessions.');b.line(1024,510,1316,510);b.hint(1024,549,'Metric','Price return','Normalize returns. Keep contract and currency definitions inspectable.');b.line(1024,636,1316,636);b.hint(1024,676,'Next investigation','','Choose one market to test its explanation.');b.button(1024,866,292,'Keep a research condition',True);b.save('10_Commodity_Comparison')
 b=desktop('forex',variant='matrix');b.rect(100,354,1240,600,'bg',0);b.panel(100,354,1240,600,'Cross-currency comparison','One-month spot returns · base in rows · quote in columns · CHF source delayed')
 cs=D['CURRENCIES'];cell=124;xx=225;yy=462
 for j,c in enumerate(cs):b.text(xx+j*cell+56,432,c['id'],13,'secondary',500,'middle')
 for i,a in enumerate(cs):
  b.text(156,yy+i*54+31,a['id'],13,'secondary',500,'middle')
  for j,z in enumerate(cs):
   cx=xx+j*cell;cy=yy+i*54
   if i==j:b.text(cx+56,cy+31,'·',16,'muted',anchor='middle');continue
   delayed=a['id']=='CHF' or z['id']=='CHF';v=((1+a['ret']/100)/(1+z['ret']/100)-1)*100;b.rect(cx,cy,114,46,'raised',6);b.text(cx+57,cy+29,'Delayed' if delayed else signed(v)+'%',12,'muted' if delayed else 'up' if v>=0 else 'down',500,'middle')
 b.save('11_Forex_Source_Gap_Matrix')
 b=desktop('bonds');b.rect(101,355,878,34,'raised',11);b.text(124,377,'HYPOTHETICAL PARALLEL SHIFT · +50 BP',10,'warn',600);b.rect(112,468,856,315,'panel',0);b.chart(124,486,832,240,[('Scenario',[v+.5 for v in D['CURVE_NOW']],'accent'),('30 Jun base',D['CURVE_NOW'],'compare')],D['TENORS'],unit='%',area=False);b.legend(124,765,[('+50 bp scenario','accent'),('30 Jun base','compare')]);b.save('12_Bonds_Exposure_Scenario')

files=[]
for i,p in enumerate(D['PAGES'],1):
 stem=f'{i:02d}_{p["id"].title()}'
 for theme in ['dark','light']:files.append(desktop(p['id'],theme).save(stem+'_'+theme))
 files.append(mobile(p['id']).save(stem+'_mobile'))
interaction_boards()
# A compact review contact sheet contains the primary dark compositions only.
thumbs=[]
for i,p in enumerate(D['PAGES'],1):
 im=Image.open(OUT/f'{i:02d}_{p["id"].title()}_dark.png').convert('RGB');im.thumbnail((720,500));thumbs.append(im)
sheet=Image.new('RGB',(1488,2080),'#0b1017')
for i,im in enumerate(thumbs):sheet.paste(im,(16+(i%2)*744,16+(i//2)*516))
sheet.save(OUT/'Other_Assets_Design_Overview.png')
(OUT/'MANIFEST.json').write_text(json.dumps({'kind':'OFFLINE_STATIC_VECTOR_COMPOSITIONS','native_paper':False,'browser_screenshots':False,'data':'illustrative','primary_desktop':16,'primary_narrow':8,'interaction_states':4,'viewport_desktop':[1440,1000],'viewport_narrow':[390,1250],'files':[f.name for f in OUT.glob('*.svg')]},indent=2))
print('Created 28 editable SVG compositions, their PNG previews, and an eight-page overview. Native Paper and HTML visual acceptance remain unproven.')
