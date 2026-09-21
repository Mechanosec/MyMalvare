"""Render the first/unchanged/new-commit timings from the local benchmark."""
import json
import statistics
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

data = json.loads(Path(sys.argv[1]).read_text())
output = Path(sys.argv[2])
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(3, 1, figsize=(10, 8.4))
fig.subplots_adjust(left=.23, right=.9, top=.82, bottom=.16, hspace=.8)
fig.suptitle('Git-кеш та інкрементальне сканування', x=.06, y=.97, ha='left', fontsize=18, fontweight='bold')
fig.text(.06, .923, '151 файл · 250 комітів · три повтори, медіана та min–max', fontsize=11, color='#485567')
colors = ['#8493a7', '#087f75']
fig.legend(handles=[Patch(color=colors[0], label='Повний скан'), Patch(color=colors[1], label='Кеш + checkpoint')], loc='upper right', bbox_to_anchor=(.94,.91), ncol=2, frameon=False, fontsize=10)
for i, (ax, title) in enumerate(zip(axes, ['Перший запуск', 'Повтор без змін', 'Після одного нового коміту'])):
    samples = [[r[i][variant]['totalMs'] for r in data['runs']] for variant in ['before', 'after']]
    medians = [statistics.median(s) for s in samples]
    maximum = max(max(s) for s in samples)
    for y, (s, m, color) in enumerate(zip(samples, medians, colors)):
        ax.barh(y, m, height=.45, color=color)
        ax.errorbar(m, y, xerr=[[m-min(s)], [max(s)-m]], fmt='none', color='#283548', capsize=4)
        ax.text(max(s)+maximum*.025, y, f'{m:.0f} мс', va='center')
    ax.set_yticks([0,1], ['Повний скан', 'З кешем'])
    ax.invert_yaxis()
    ax.set_xlim(0, maximum*1.28)
    ratio = medians[0]/medians[1]
    comparison = f'{ratio:.1f}× швидше' if ratio >= 1 else f'+{(1/ratio-1)*100:.0f}% часу'
    ax.set_title(f'{title}: {comparison}', loc='left', fontweight='bold', fontsize=12)
    ax.set_xlabel('Час, мс — окрема шкала для кожного сценарію', fontsize=9, color='#485567')
    ax.spines['left'].set_visible(False)
    ax.set_axisbelow(True)
    ax.grid(axis='x', alpha=.2)
fig.text(.06,.055, 'Порівняння з уже оптимізованим повним сканером. Локальний Git; без мережі та БД.\nНакопичені finding-події збігаються після кожного етапу; службові витрати кешу включено.', fontsize=10, color='#485567')
fig.savefig(output.with_suffix('.png'), dpi=160, facecolor='white')
fig.savefig(output.with_suffix('.svg'), facecolor='white')
