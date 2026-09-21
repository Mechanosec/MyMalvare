"""Render reproducible before/after charts from benchmark-scan.cjs JSON output."""
import json
import statistics
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

source = Path(sys.argv[1])
output = Path(sys.argv[2])
data = json.loads(source.read_text())
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False})
labels = {'many-files': 'Багато файлів\n601 файл · 1 коміт', 'history': 'Історія змін\n81 файл · 80 комітів', 'many-findings': 'Багато збігів\n7 файлів · 2 коміти'}
colors = {'before': '#8493a7', 'after': '#087f75'}
fig, axes = plt.subplots(3, 1, figsize=(10, 8.1))
fig.subplots_adjust(left=.24, right=.91, top=.85, bottom=.16, hspace=.72)
fig.suptitle('Сканування credsScrapper: до / після', x=.06, y=.97, ha='left', fontsize=19, fontweight='bold')
fig.text(.06, .923, 'Три повтори · медіана та min–max · менше часу — краще', fontsize=11, color='#485567')
fig.legend(handles=[Patch(color=colors[v], label=t) for v,t in [('before','До'),('after','Після')]], loc='upper right', bbox_to_anchor=(.94,.94), ncol=2, frameon=False)
for ax, case in zip(axes, data['results']):
    samples = [[r['totalMs'] for r in case['runs'][v]] for v in ['before','after']]
    medians = [statistics.median(s) for s in samples]
    maximum = max(max(s) for s in samples)
    for row,(v,s,m) in enumerate(zip(['before','after'],samples,medians)):
        ax.barh(row,m,height=.43,color=colors[v])
        ax.errorbar(m,row,xerr=[[m-min(s)],[max(s)-m]],fmt='none',color='#283548',capsize=4,linewidth=1.4)
        ax.text(max(s)+maximum*.025,row,f'{m:,.0f} мс'.replace(',',' '),va='center',fontsize=11)
    ax.set_yticks([0,1],['До','Після'])
    ax.invert_yaxis()
    ax.set_xlim(0, maximum*1.28)
    ax.set_xlabel('Час, мс — окрема шкала для кожного набору',fontsize=9,color='#485567')
    ax.set_title(f'{labels[case["name"]].splitlines()[0]}: {medians[0]/medians[1]:.1f}× швидше',loc='left',fontsize=12,fontweight='bold',pad=8)
    ax.text(-.28,.5,labels[case['name']].splitlines()[1],transform=ax.transAxes,ha='left',va='center',fontsize=10)
    ax.spines['left'].set_visible(False)
    ax.set_axisbelow(True)
    ax.grid(axis='x',alpha=.2)
fig.text(.06,.045,'Локальний clone + Git I/O + детекція. Без мережі, Redis, БД та Piscina.\nСинтетичні дані; findings, шляхи, коміти та номери рядків збігаються до/після.',fontsize=10,color='#485567')
fig.savefig(output.with_suffix('.png'),dpi=160,facecolor='white')
fig.savefig(output.with_suffix('.svg'),facecolor='white')
plt.close(fig)

# Stacked phases use one real run (the median-total run), so the parts sum
# exactly to the measured total instead of summing unrelated phase medians.
fields = [('cloneMs','Clone','#bfc7d3'),('historyReadMs','Історія Git','#6389b7'),('headReadMs','Читання HEAD','#e2a64a'),('detectionMs','Детекція','#087f75'),('other','Інше','#d9dce2')]
fig, axes = plt.subplots(3,1,figsize=(10,8))
fig.subplots_adjust(left=.13,right=.96,top=.83,bottom=.14,hspace=.7)
fig.suptitle('Куди йде час сканування',x=.06,y=.97,ha='left',fontsize=19,fontweight='bold')
fig.legend(handles=[Patch(color=c,label=l) for _,l,c in fields],loc='upper left',bbox_to_anchor=(.05,.94),ncol=5,frameon=False,fontsize=10)
for ax,case in zip(axes,data['results']):
    chosen=[sorted(case['runs'][v],key=lambda r:r['totalMs'])[1] for v in ['before','after']]
    for row,run in enumerate(chosen):
        left=0
        for key,label,color in fields:
            value=run[key] if key!='other' else max(0,run['totalMs']-sum(run[k] for k,_,_ in fields[:-1]))
            ax.barh(row,value,left=left,height=.42,color=color)
            left+=value
        ax.text(left+max(r['totalMs'] for r in chosen)*.02,row,f'{left:.0f} мс',va='center',fontsize=10)
    ax.set_yticks([0,1],['До','Після']);ax.invert_yaxis()
    ax.set_xlim(0,max(r['totalMs'] for r in chosen)*1.15)
    ax.set_title(labels[case['name']].splitlines()[0],loc='left',fontweight='bold',fontsize=12)
    ax.set_xlabel('Час, мс — окрема шкала для кожного набору',fontsize=9)
    ax.spines['left'].set_visible(False)
fig.text(.06,.035,'Для кожного варіанта показано запуск із медіанним загальним часом. Сума етапів дорівнює повному часу.',fontsize=9,color='#485567')
fig.savefig(output.with_name(output.stem+'-stages').with_suffix('.png'),dpi=160,facecolor='white')
plt.close(fig)
