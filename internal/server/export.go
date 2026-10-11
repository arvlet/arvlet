package server

import (
	"database/sql"
	"net/http"
)

func (s *Server) export(w http.ResponseWriter, r *http.Request) error {
	tx, err := s.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tables := map[string]any{}
	for _, table := range []string{"artifacts", "versions", "states", "entries"} {
		rows, e := tx.Query("SELECT * FROM " + table)
		if e != nil {
			return e
		}
		cols, e := rows.Columns()
		if e != nil {
			rows.Close()
			return e
		}
		items := []map[string]any{}
		for rows.Next() {
			values := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if e = rows.Scan(ptrs...); e != nil {
				rows.Close()
				return e
			}
			item := map[string]any{}
			for i, c := range cols {
				item[c] = values[i]
			}
			items = append(items, item)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		tables[table] = items
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	w.Header().Set("Content-Disposition", `attachment; filename="arvlet-export.json"`)
	respond(w, 200, map[string]any{"schema_version": 1, "exported_at": stamp(), "tables": tables})
	return nil
}
