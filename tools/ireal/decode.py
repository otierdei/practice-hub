import sys, re, urllib.parse, json
def obf(s):
    n=list(s)
    for i in list(range(5))+list(range(10,24)):
        n[49-i]=s[i]; n[i]=s[49-i]
    return ''.join(n)
def unscramble(s):
    r=''; p=s
    while len(p)>50:
        seg=p[:50]; p=p[50:]
        r+= seg if len(p)<2 else obf(seg)
    return r+p
html=open(sys.argv[1],encoding='utf-8').read()
url=re.search(r'href="(irealb://[^"]+)"',html).group(1)
body=urllib.parse.unquote(url[len('irealb://'):])
parts=body.split('===')
songs=[]
for p in parts:
    f=p.split('=')
    if len(f)<6 or not f[0]: continue
    music=[x for x in f if x.startswith('1r34LbKcu7')]
    if not music: continue
    m=unscramble(music[0][len('1r34LbKcu7'):])
    m=m.replace('XyQ','   ').replace('LZ',' |').replace('Kcl','| x')
    idx=f.index(music[0])
    songs.append({'title':f[0],'composer':f[1],'style':f[3],'key':f[4],'music':m,'rest':f[idx+1:]})
json.dump(songs,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
for s in songs: print(s['title'],'|',s['composer'],'|',s['style'],'|',s['key'],'|',s['rest']); print('  ',s['music'])
