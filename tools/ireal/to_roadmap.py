import json, re, sys
songs=json.load(open(sys.argv[1]))
QMAP=[('-^7','m(maj7)'),('^7','maj7'),('^9','maj9'),('^','maj7'),('h7','m7b5'),('h','m7b5'),('o7','dim7'),('o','dim')]
def chord(t):
    m=re.match(r'^([A-G][b#]?)([^/]*)(?:/([A-G][b#]?))?$',t)
    if not m: raise ValueError('Akkord '+t)
    r,q,b=m.groups()
    for a,z in QMAP:
        if q.startswith(a): q=z+q[len(a):]; break
    else:
        if q.startswith('-'): q='m'+q[1:]
    return r+q+('/'+b if b else '')
def tokens(music):
    m=re.sub(r'\([^)]*\)','',music)          # Alternativakkorde weglassen
    m=re.sub(r'<[^>]*>','',m)
    sig='4/4'
    t=re.search(r'T(\d)(\d)',m)
    if t: sig={'44':'4/4','34':'3/4','68':'6/8','12':'12/8'}.get(t.group(1)+t.group(2),'4/4')
    m=re.sub(r'T\d\d','',m)
    m=re.sub(r'[USQfslY]','',m)  # Ende, Segno, Coda, Fermate, Größe, Abstand
    ev=[]; cur=[]
    i=0
    def flush():
        nonlocal cur
        txt=' '.join(cur).strip()
        if txt: ev.append(('bar',txt))
        cur=[]
    for tok in re.findall(r'\*[A-Za-z]|N[123]|[\[\]{}|Z]|[^\s\[\]{}|Z*]+',m):
        if tok.startswith('*'): flush(); ev.append(('sec',tok[1]))
        elif tok in ('N1','N2','N3'): flush(); ev.append(('end',int(tok[1])))
        elif tok=='{': flush(); ev.append(('rs',None))
        elif tok=='}': flush(); ev.append(('re',None))
        elif tok=='[': flush(); ev.append(('br',None))
        elif tok in ']|Z': flush()
        else: cur.append(tok)
    flush()
    return sig,ev
def linear(ev):
    out=[]; sec=None; i=0; start=None; passno=1; ending=None; inst=0
    while i<len(ev):
        k,v=ev[i]
        if k=='rs': start=i; inst+=1
        elif k=='br': inst+=1
        elif k=='sec':
            if not (i>0 and ev[i-1][0] in ('rs','br')): inst+=1
            sec=v
        elif k=='end':
            ending=v
            if v!=passno:  # Schluss überspringen bis zum nächsten Schluss oder Ende
                j=i+1
                while j<len(ev) and ev[j][0] not in ('end','re'): j+=1
                if j<len(ev) and ev[j][0]=='re': j+=1
                i=j; continue
        elif k=='re':
            if passno==1 and start is not None: passno=2; i=start; ending=None; continue
        elif k=='bar': out.append((sec, (inst,passno), v))
        i+=1
    return out
def barchords(txt, prev):
    res=[]
    for t in txt.split():
        if t=='x': res.append('%')
        elif t=='n': res.append('N.C.')
        elif t=='r': res.append('R')
        else: res.append(chord(t))
    return res[:4]
TYPES={'i':('intro',''),'V':('verse','')}
out=[]
for s in songs:
    sig,ev=tokens(s['music'])
    bars=linear(ev)
    # "r" = letzte zwei Takte wiederholen
    flat=[]
    for sec,end,txt in bars:
        c=barchords(txt,None)
        if c==['R']:
            flat.append((sec,end,['%'])); flat.append((sec,end,['%','R2']))
        else: flat.append((sec,end,c))
    res=[]
    for sec,end,c in flat:
        res.append([sec,end,c])
    for i,(sec,end,c) in enumerate(res):
        if c==['%','R2']: res[i][2]=list(res[i-2][2]); res[i-1][2]=list(res[i-3][2])
    # Teile bilden
    groups=[]
    for sec,end,c in res:
        key=(sec,)
        if not groups or groups[-1]['sec']!=sec or groups[-1]['end']!=end:
            groups.append({'sec':sec,'end':end,'bars':[]})
        groups[-1]['bars'].append({'c':c})
    # gleiche Teile zusammenführen
    sections=[]; order=[]
    for g in groups:
        letter=g['sec'] or ''
        sig_b=json.dumps(g['bars'])
        found=next((x for x in sections if x['_b']==sig_b),None)
        if not found:
            typ,_=TYPES.get(letter,('other',''))
            same=[x for x in sections if x['_l']==letter]
            name=(letter if letter not in TYPES else '') if letter else ('Blues' if len(g['bars'])==12 else 'Form')
            if 'Dorian' in s['title']:
                name=re.match(r'[A-G][b#]?',g['bars'][0]['c'][0]).group(0)+' dorisch'
            elif same:
                if same[0]['name']==letter: same[0]['name']=letter+'1'
                name=letter+str(len(same)+1)
            sid=(letter.lower() or 'f')+str(len(sections)+1)
            found={'id':sid,'type':typ,'name':name,'bars':g['bars'],'_b':sig_b,'_l':letter}
            sections.append(found)
        if order and order[-1]['s']==found['id']: order[-1]['x']+=1
        else: order.append({'s':found['id'],'x':1})
    for x in sections: del x['_b']; del x['_l']
    key=s['key'].replace('-','m')
    bpm=int(s['rest'][1]) if len(s['rest'])>1 and s['rest'][1].isdigit() and int(s['rest'][1])>0 else None
    style=(s['rest'][0] or s['style']).replace('Jazz-','')
    rm={'kind':'roadmap','v':1,'sig':sig,'key':key,'style':style,'sections':sections,'order':order}
    bpm=bpm or {'Corcovado':140,'Bluesette':120}.get(s['title'])  # Wert aus der iReal Liste (Stil Standard)
    if bpm: rm['bpm']=bpm
    out.append({'title':s['title'],'composer':s['composer'],'roadmap':rm})
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
