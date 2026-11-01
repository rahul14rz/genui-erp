import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';

class AskBox extends StatefulWidget {
  const AskBox({super.key, required this.onAsk, required this.focusNode, this.busy = false});

  final ValueChanged<String> onAsk;
  final FocusNode focusNode;
  final bool busy;

  @override
  State<AskBox> createState() => _AskBoxState();
}

class _AskBoxState extends State<AskBox> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _submit() {
    final q = _text.text.trim();
    if (q.isEmpty) return;
    widget.onAsk(q);
    _text.clear();
    widget.focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final isMac = Theme.of(context).platform == TargetPlatform.macOS || Theme.of(context).platform == TargetPlatform.iOS;
    return Row(children: [
      Expanded(
        child: TextField(
          controller: _text,
          focusNode: widget.focusNode,
          style: context.type.body,
          textInputAction: TextInputAction.send,
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            hintText: 'Ask about orders, stock, dispatch or invoices',
            suffixText: isMac ? '⌘K' : 'Ctrl K',
            suffixStyle: context.type.caption,
          ),
        ),
      ),
      const SizedBox(width: Space.x2),
      ErpButton(label: 'Ask', kind: ButtonKind.primary, busy: widget.busy, onPressed: _submit),
    ]);
  }
}
