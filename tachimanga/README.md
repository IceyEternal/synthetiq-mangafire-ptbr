# Fontes PT-BR para Tachimanga

Repositório Tachimanga:

`https://raw.githubusercontent.com/IceyEternal/synthetiq-mangafire-ptbr/main/tachimanga/index.min.json`

Extensões incluídas:

- MangaFire PT-BR — principal;
- MangaDex PT-BR — backup;
- Taiyō PT-BR — backup;
- Niadd PT-BR — backup adicional;
- NoxManga PT-BR — backup adicional.

Os JARs são baseados nas extensões atuais da Keiyoushi, usam `minSdk = 21`, têm a otimização ProGuard/R8 desativada (`-dontoptimize`) e packages próprios para não colidirem com builds oficiais.

O workflow verifica a Keiyoushi automaticamente de 6 em 6 horas. Quando o código upstream muda, recompila as cinco extensões e atualiza o índice do repositório.
