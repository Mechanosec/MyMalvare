"""Plot measured samples; timings with different coverage stay in separate panels."""
import json,statistics,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
r=json.load(open(sys.argv[1]));fig,axes=plt.subplots(2,2,figsize=(13,10));fig.subplots_adjust(left=.10,right=.97,bottom=.10,top=.87,wspace=.5,hspace=.6)
plt.rcParams.update({'font.size':10})
fig.suptitle('credsScrapper: де витрачається час',fontsize=20,fontweight='bold',y=.97)
fig.text(.1,.92,'Фактичні вимірювання · менше часу — краще · різне покриття не порівнюємо як рівноцінне',fontsize=10)
ax=axes[0,0];names=list(dict.fromkeys(x['repo'] for x in r['repeated']));colors=['#64748b','#0d9488']
for i,variant in enumerate(['baseline','fast-node']):
 vals=[];lo=[];hi=[]
 for name in names:
  a=[x['elapsedMs']/1000 for x in r['repeated'] if x['repo']==name and x['variant']==variant and not x['timeout']];m=statistics.median(a);vals.append(m);lo.append(m-min(a));hi.append(max(a)-m)
 ys=[j+(i-.5)*.32 for j in range(len(names))];ax.barh(ys,vals,height=.30,color=colors[i],label=['Node поточний','Node маркери + масив'][i],xerr=[lo,hi],capsize=3)
ax.set_yticks(range(len(names)),[n.split('/')[0] for n in names]);ax.set_xscale('log');ax.set_xlabel('Секунди, логарифмічна шкала');ax.set_title('100 останніх комітів + HEAD\n3 повтори, медіана та min–max');ax.legend(fontsize=8)
ax=axes[0,1];a=[x for x in r['exploratory'] if x['variant']=='baseline'];y=list(range(len(a)))
d=[100*x['detectionMs']/x['elapsedMs'] for x in a];g=[100*x['historyReadMs']/x['elapsedMs'] for x in a]
ax.barh(y,d,color='#0d9488',label='Детектор');ax.barh(y,g,left=d,color='#f59e0b',label='Git історія');ax.barh(y,[100-d[i]-g[i] for i in y],left=[d[i]+g[i] for i in y],color='#cbd5e1',label='Інше')
ax.set_yticks(y,[x['repo'].split('/')[0] for x in a]);ax.set_xlabel('% спостережуваного часу');ax.set_title('Розподіл часу скану з кешу\nВеликі скани зупинені лімітом 40 с');ax.legend(fontsize=8,loc='upper left',bbox_to_anchor=(0,-.22),ncol=3)
ax=axes[1,0];modes=['full-git','shallow-git','archive','api-blobs'];vals=[statistics.median(x['ms']/1000 for x in r['acquisition']['runs'] if x['mode']==m) for m in modes];ax.barh(range(4),vals,color=['#64748b','#0d9488','#0d9488','#0d9488']);ax.set_yticks(range(4),['Повний Git (історія)','Shallow Git (HEAD)','Архів (HEAD)','API 31 запит (HEAD)']);ax.set_xlabel('Секунди');ax.set_title('Отримання cabana-dashboards\nРізне покриття: історія проти HEAD')
for i,v in enumerate(vals):ax.text(v+.3,i,f'{v:.2f}',va='center')
ax.set_xlim(0,max(vals)*1.2)
ax=axes[1,1];case=next(x for x in r['entropy'] if x['name']=='dense');modes=['node-current','node-typed-array','go-regex','go-ascii'];vals=[statistics.median(x['ms'] for x in case['results'] if x['mode']==m) for m in modes];ax.barh(range(4),vals,color=['#64748b','#0d9488','#64748b','#0d9488']);ax.set_yticks(range(4),['Node поточний','Node typed array','Go regexp','Go byte loop']);ax.set_xlabel('Мілісекунди');ax.set_title('Лише ядро ентропії, синтетичні дані\n3 повтори; це НЕ повний Go-сканер')
for i,v in enumerate(vals):ax.text(v+2,i,f'{v:.1f}',va='center')
ax.set_xlim(0,max(vals)*1.22)
for ax in axes.flat:ax.spines[['top','right']].set_visible(False);ax.invert_yaxis()
fig.text(.1,.035,'Без live-перевірок ключів. Скани з кешу виключають мережу, Piscina, Redis та БД. Повні обмеження — у звіті.',fontsize=9,color='#475569')
fig.savefig(sys.argv[2],dpi=160,facecolor='white',bbox_inches='tight')
