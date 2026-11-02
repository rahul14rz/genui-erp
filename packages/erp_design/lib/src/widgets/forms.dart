import 'package:flutter/material.dart';

import '../catalog/generated.dart' as g;
import '../theme.dart';
import '../tokens.dart';
import 'primitives.dart';
import 'records.dart';

enum Decision { approve, reject }

class ApprovalFormView extends StatefulWidget {
  const ApprovalFormView(this.data, {super.key, required this.onDecide, this.busy = false});

  final g.ApprovalForm data;
  final void Function(Decision decision, String reason) onDecide;
  final bool busy;

  @override
  State<ApprovalFormView> createState() => _ApprovalFormViewState();
}

class _ApprovalFormViewState extends State<ApprovalFormView> {
  final _reason = TextEditingController();

  @override
  void initState() {
    super.initState();
    _reason.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final d = widget.data;
    final ready = _reason.text.trim().length >= 3 && !widget.busy;
    return ErpSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(d.title, style: t.heading)),
              const StatusBadge('pending'),
            ],
          ),
          const SizedBox(height: Space.x1),
          Text('Requested by ${d.requestedBy}', style: t.bodySecondary),
          const SizedBox(height: Space.x3),
          Text(d.reason, style: t.body),
          if (d.impact.isNotEmpty) ...[
            const SizedBox(height: Space.x4),
            Wrap(
              spacing: Space.x6,
              runSpacing: Space.x3,
              children: [for (final f in d.impact) FieldValue(label: f.label, type: f.type, value: f.value)],
            ),
          ],
          const SizedBox(height: Space.x4),
          TextField(
            controller: _reason,
            minLines: 1,
            maxLines: 3,
            style: t.body,
            decoration: const InputDecoration(hintText: 'Reason for your decision (required)'),
          ),
          const SizedBox(height: Space.x3),
          Row(
            children: [
              ErpButton(
                label: 'Approve',
                kind: ButtonKind.primary,
                busy: widget.busy,
                onPressed: ready ? () => widget.onDecide(Decision.approve, _reason.text.trim()) : null,
              ),
              const SizedBox(width: Space.x2),
              ErpButton(
                label: 'Reject',
                onPressed: ready ? () => widget.onDecide(Decision.reject, _reason.text.trim()) : null,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Shows exactly what a write will change. Nothing runs until Confirm.
class ConfirmActionView extends StatelessWidget {
  const ConfirmActionView(
    this.data, {
    super.key,
    required this.onConfirm,
    required this.onCancel,
    this.busy = false,
    this.done,
  });

  final g.ConfirmAction data;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;
  final bool busy;

  /// Set once the server has applied the change, to show the outcome in place.
  final String? done;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = context.type;
    String show(Object? v) => v == null ? 'none' : '$v';
    return ErpSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(data.title, style: t.heading),
          const SizedBox(height: Space.x1),
          Text(data.summary, style: t.bodySecondary),
          const SizedBox(height: Space.x4),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: c.border),
              borderRadius: Radii.control,
            ),
            child: Column(
              children: [
                for (var i = 0; i < data.changes.length; i++)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: Space.x3, vertical: Space.x2),
                    decoration: BoxDecoration(
                      border: i == 0 ? null : Border(top: BorderSide(color: c.border)),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          flex: 3,
                          child: Text(
                            '${data.changes[i].entity} ${data.changes[i].label}, ${data.changes[i].field}',
                            style: t.body,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Expanded(
                          flex: 2,
                          child: Text(
                            show(data.changes[i].from),
                            style: t.mono.copyWith(color: c.danger, decoration: TextDecoration.lineThrough),
                            textAlign: TextAlign.right,
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: Space.x2),
                          child: Icon(Icons.arrow_forward, size: 14, color: c.textMuted, semanticLabel: 'changes to'),
                        ),
                        Expanded(
                          flex: 2,
                          child: Text(
                            show(data.changes[i].to),
                            style: t.mono.copyWith(color: c.success, fontWeight: FontWeight.w500),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Space.x4),
          if (done != null)
            Text(done!, style: t.bodyStrong.copyWith(color: c.success))
          else
            Row(
              children: [
                ErpButton(label: 'Confirm', kind: ButtonKind.primary, busy: busy, onPressed: busy ? null : onConfirm),
                const SizedBox(width: Space.x2),
                ErpButton(label: 'Cancel', onPressed: busy ? null : onCancel),
              ],
            ),
        ],
      ),
    );
  }
}

class FilterBarView extends StatefulWidget {
  const FilterBarView(this.data, {super.key, required this.onApply});

  final g.FilterBar data;
  final ValueChanged<Map<String, Object?>> onApply;

  @override
  State<FilterBarView> createState() => _FilterBarViewState();
}

class _FilterBarViewState extends State<FilterBarView> {
  late final Map<String, Object?> _values = {for (final f in widget.data.filters) f.key: f.value};
  late final Map<String, TextEditingController> _text = {
    for (final f in widget.data.filters)
      if (f.kind == g.FilterBarFilterKind.text || f.kind == g.FilterBarFilterKind.dateRange)
        f.key: TextEditingController(text: f.value is String ? f.value! as String : ''),
  };

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final c = context.colors;
    Widget field(g.FilterBarFilter f) {
      final label = Text(f.label, style: t.caption.copyWith(color: c.textSecondary));
      final control = switch (f.kind) {
        g.FilterBarFilterKind.select => DropdownButtonHideUnderline(
          child: Container(
            height: 36,
            padding: const EdgeInsets.symmetric(horizontal: Space.x3),
            decoration: BoxDecoration(
              border: Border.all(color: c.borderStrong),
              borderRadius: Radii.control,
              color: c.surface,
            ),
            child: DropdownButton<String>(
              value: _values[f.key] as String?,
              hint: Text('Any', style: t.body.copyWith(color: c.textMuted)),
              style: t.body,
              dropdownColor: c.surface,
              items: [
                for (final o in f.options ?? const <String>[])
                  DropdownMenuItem(value: o, child: Text(o.replaceAll('_', ' '))),
              ],
              onChanged: (v) => setState(() => _values[f.key] = v),
            ),
          ),
        ),
        g.FilterBarFilterKind.toggle => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Checkbox(
              value: _values[f.key] == true,
              onChanged: (v) => setState(() => _values[f.key] = v ?? false),
              side: BorderSide(color: c.borderStrong),
              activeColor: c.accent,
            ),
          ],
        ),
        _ => SizedBox(
          width: f.kind == g.FilterBarFilterKind.dateRange ? 220 : 180,
          child: TextField(
            controller: _text[f.key],
            style: t.body,
            decoration: InputDecoration(
              hintText: f.kind == g.FilterBarFilterKind.dateRange ? '2026-01-01..2026-06-30' : 'Any',
            ),
            onChanged: (v) => _values[f.key] = v.isEmpty ? null : v,
            onSubmitted: (_) => widget.onApply(Map.of(_values)),
          ),
        ),
      };
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          label,
          const SizedBox(height: Space.x1),
          control,
        ],
      );
    }

    return ErpSurface(
      padding: const EdgeInsets.all(Space.x3),
      child: Wrap(
        spacing: Space.x4,
        runSpacing: Space.x3,
        crossAxisAlignment: WrapCrossAlignment.end,
        children: [
          for (final f in widget.data.filters) field(f),
          ErpButton(label: 'Apply', kind: ButtonKind.primary, onPressed: () => widget.onApply(Map.of(_values))),
        ],
      ),
    );
  }
}
