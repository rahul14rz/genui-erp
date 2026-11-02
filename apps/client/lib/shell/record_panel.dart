import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';

/// Guesses a cell type from a field name, for rows opened in the side panel.
CellType cellTypeFor(String key, Object? value) {
  final k = key.toLowerCase();
  if (k.endsWith('cents')) return CellType.money;
  if (k.endsWith('pct')) return CellType.percent;
  if (k.endsWith('at')) return CellType.datetime;
  if (k.endsWith('by') && value is String && RegExp(r'^\d{4}-').hasMatch(value)) return CellType.date;
  if (k == 'status' || k == 'kind') return CellType.status;
  if (k == 'number' || k == 'ordernumber' || k == 'sku' || k == 'code' || k.endsWith('code') || k == 'reference')
    return CellType.mono;
  if (value is num) return CellType.number;
  return CellType.text;
}

String labelFor(String key) {
  final words = key
      .replaceAll(RegExp(r'Cents$'), '')
      .replaceAllMapped(RegExp('([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
      .toLowerCase();
  return words.isEmpty ? key : words[0].toUpperCase() + words.substring(1);
}

/// Details for one table row. Esc or the close button dismisses it.
class RecordPanel extends StatelessWidget {
  const RecordPanel({super.key, required this.row, required this.onClose, required this.onAsk});

  final Map<String, Object?> row;
  final VoidCallback onClose;
  final ValueChanged<String> onAsk;

  String? get _orderNumber {
    for (final k in ['orderNumber', 'number']) {
      final v = row[k];
      if (v is String && v.startsWith('SO-')) return v;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final c = context.colors;
    final entries = row.entries.where((e) => e.value is! Map && e.value is! List).toList();
    final title = (row['orderNumber'] ?? row['number'] ?? row['sku'] ?? row['code'] ?? row['label'] ?? 'Record')
        .toString();
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(left: BorderSide(color: c.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.x4, Space.x3, Space.x2, Space.x3),
            child: Row(
              children: [
                Expanded(child: Text(title, style: t.heading)),
                IconButton(
                  tooltip: 'Close (Esc)',
                  icon: Icon(Icons.close, size: 18, color: c.textSecondary),
                  onPressed: onClose,
                ),
              ],
            ),
          ),
          Divider(height: 1, color: c.border),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(Space.x4),
              children: [
                for (final e in entries) ...[
                  FieldValue(label: labelFor(e.key), type: cellTypeFor(e.key, e.value), value: e.value),
                  const SizedBox(height: Space.x3),
                ],
                if (_orderNumber != null) ...[
                  const SizedBox(height: Space.x2),
                  ErpButton(label: 'Open full order', onPressed: () => onAsk('Show order $_orderNumber')),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
