#!/bin/bash
# backup_supabase.sh
# Backup completo do projecto Supabase: schema, RLS, dados, edge functions
#
# Pre-requisito: estar autenticado no CLI
#   ./supabase.exe login

PROJECT_REF="ytwwcrhtcsdpqeualnsx"
SUPABASE="./supabase.exe"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/backup_$DATE"

mkdir -p "$BACKUP_DIR/functions"

echo ""
echo "=== Backup Supabase: $PROJECT_REF ==="
echo "=== Destino: $BACKUP_DIR ==="
echo ""

# Ligar o CLI ao projecto
echo "[0/3] A ligar ao projecto..."
$SUPABASE link --project-ref $PROJECT_REF
echo ""

echo "[1/3] Schema (tabelas, RLS, policies, funções SQL, triggers)..."
$SUPABASE db dump -f "$BACKUP_DIR/schema.sql"
echo "      -> $BACKUP_DIR/schema.sql"

echo ""
echo "[2/3] Dados..."
$SUPABASE db dump --data-only -f "$BACKUP_DIR/data.sql"
echo "      -> $BACKUP_DIR/data.sql"

echo ""
echo "[3/3] Edge Functions..."
for fn in clever-worker invite-user send-order-email delete-or-suspend-user; do
  $SUPABASE functions download $fn --project-ref $PROJECT_REF
  # o CLI descarrega para supabase/functions/<slug>/
  if [ -d "supabase/functions/$fn" ]; then
    cp -r "supabase/functions/$fn" "$BACKUP_DIR/functions/$fn"
    echo "      -> $BACKUP_DIR/functions/$fn/"
  else
    echo "      AVISO: nao encontrado supabase/functions/$fn"
  fi
done

echo ""
echo "=== Backup concluido: $BACKUP_DIR ==="
echo ""
echo "NOTA: O seguinte NAO esta incluido neste backup:"
echo "  - Ficheiros Storage (SVGs, thumbnails) - copiar via Dashboard"
echo "  - Config Auth (email templates)        - copiar via Dashboard -> Auth -> Settings"
echo "  - Secrets das Edge Functions           - copiar via Dashboard -> Functions -> Secrets"
echo ""
