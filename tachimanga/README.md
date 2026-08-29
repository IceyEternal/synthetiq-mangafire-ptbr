# Fontes PT-BR para Tachimanga

Builds baseadas nas extensões atuais da Keiyoushi e recompiladas para Tachimanga:

- MangaFire PT-BR — principal;
- MangaDex PT-BR — backup;
- Niadd PT-BR — segundo backup.

Todas usam `minSdk = 21`, têm a otimização ProGuard/R8 desativada (`-dontoptimize`) e packages próprios para não colidirem com builds oficiais.

Este workflow verifica a Keiyoushi automaticamente de 6 em 6 horas. Quando o código upstream muda, recompila as três extensões e substitui os JARs deste diretório.
