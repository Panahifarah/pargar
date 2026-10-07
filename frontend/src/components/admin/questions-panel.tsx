"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Eye, Plus, Save, Trash2 } from "lucide-react";
import { http, toUserError } from "@/lib/api";
import type { Lesson, MCQQuestion } from "@/lib/types";
import { useConfirm } from "@/components/admin/use-confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatOptionLetter } from "@/lib/utils";
import { toast } from "@/components/providers";
import { Skeleton } from "@/components/ui/skeleton";

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const STEPS = [
  { id: 1 as const, label: "متن و گزینه‌ها" },
  { id: 2 as const, label: "پاسخ درست" },
  { id: 3 as const, label: "پیش‌نمایش نهایی" },
];

export function QuestionsPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [lessonId, setLessonId] = useState<number | null>(null);
  const [modal, setModal] = useState<MCQQuestion | null>(null);

  const { data: lessonsData } = useQuery({
    queryKey: ["admin", "lessons"],
    queryFn: () => http.get<{ lessons: Lesson[] }>("/api/admin/lessons"),
  });
  const lessons = [...(lessonsData?.lessons ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    if (lessonId == null && lessons[0]) setLessonId(lessons[0].id);
  }, [lessons, lessonId]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "questions", lessonId],
    queryFn: () => http.get<{ questions: MCQQuestion[] }>(`/api/admin/lessons/${lessonId}/questions`),
    enabled: !!lessonId,
  });
  const qs = data?.questions ?? [];
  const selected = lessons.find((l) => l.id === lessonId);

  const save = async (qv: MCQQuestion) => {
    try {
      if (qv.id) await http.put(`/api/admin/questions/${qv.id}`, qv);
      else await http.post(`/api/admin/lessons/${qv.lessonId}/questions`, qv);
      setModal(null);
      qc.invalidateQueries({ queryKey: ["admin", "questions"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.success(qv.id ? "سوال ذخیره شد" : "سوال اضافه شد");
    } catch (e) {
      toast.error(toUserError(e, "ذخیرهٔ سوال ممکن نشد"));
    }
  };

  const move = async (idx: number, delta: number) => {
    const to = idx + delta;
    if (to < 0 || to >= qs.length) return;
    const next = reorderArray(qs, idx, to);
    try {
      for (let i = 0; i < next.length; i++) {
        if (next[i].position !== i + 1) {
          await http.put(`/api/admin/questions/${next[i].id}`, { ...next[i], position: i + 1 });
        }
      }
      qc.invalidateQueries({ queryKey: ["admin", "questions"] });
    } catch (e) {
      toast.error(toUserError(e, "جابه‌جایی سوال ممکن نشد"));
    }
  };

  const del = async (q: MCQQuestion) => {
    if (!(await confirm("حذف سوال", `سوال «${q.question.slice(0, 60)}…» حذف شود؟`))) return;
    try {
      await http.del(`/api/admin/questions/${q.id}`);
      qc.invalidateQueries({ queryKey: ["admin", "questions"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    } catch (e) {
      toast.error(toUserError(e, "حذف سوال ممکن نشد"));
    }
  };

  const openNew = () => {
    if (!lessonId) return;
    setModal({
      id: 0,
      lessonId,
      position: qs.length + 1,
      question: "",
      options: ["", "", ""],
      answerIndex: 0,
      explanation: "",
    });
  };

  return (
    <>
      {dialog}
      <div className="space-y-4">
        <Card>
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="text-base">انتخاب درس</CardTitle>
            <p className="text-xs text-muted-foreground">سوالات آزمون متعلق به یک درس‌اند؛ اول درس را انتخاب کنید.</p>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {lessons.map((l) => {
                const active = l.id === lessonId;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLessonId(l.id)}
                    className={cn(
                      "flex h-[4.25rem] w-40 shrink-0 flex-col justify-center rounded-xl border px-3 text-right transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-offset-sm"
                        : "border-border bg-card hover:border-primary/40"
                    )}
                  >
                    <p className="text-[10px] font-bold opacity-70">L{l.id}</p>
                    <p className="truncate text-sm font-extrabold leading-snug">{l.title}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">
                سوالات {selected ? `· ${selected.title}` : ""}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {qs.length} سوال · تک‌پاسخی · ترتیب با فلش‌ها
              </p>
            </div>
            <Button className="h-10 shrink-0 gap-1.5" disabled={!lessonId} onClick={openNew}>
              <Plus className="h-4 w-4" /> سوال جدید
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            )}
            {qs.map((q, i) => (
              <div
                key={q.id}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_4.5rem_5.5rem]"
              >
                <Badge
                  variant="secondary"
                  className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl p-0 font-black"
                >
                  {i + 1}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold leading-snug">{q.question}</p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {q.options.map((o, oi) => {
                      const isAns = oi === q.answerIndex;
                      return (
                        <span
                          key={oi}
                          className={cn(
                            "flex min-h-9 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-bold",
                            isAns
                              ? "border-success/50 bg-success/10 text-success"
                              : "border-border text-muted-foreground"
                          )}
                        >
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-background px-1 text-[9px] font-bold">
                            {formatOptionLetter(oi)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{o || "(خالی)"}</span>
                          {isAns && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="hidden flex-col items-center gap-0.5 sm:flex">
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={i === qs.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-col items-stretch gap-1">
                  <Button size="sm" variant="outline" className="h-8 w-full" onClick={() => setModal(q)}>
                    ویرایش
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-full text-destructive"
                    onClick={() => del(q)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {qs.length === 0 && !isLoading && lessonId && (
              <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
                <p className="text-lg font-black">هنوز سوالی نیست</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  حداقل دو گزینهٔ پر و یک پاسخ درست مشخص کنید تا آزمون این درس زنده شود.
                </p>
                <Button className="mt-5 gap-1.5" onClick={openNew}>
                  <Plus className="h-4 w-4" /> ساخت اولین سوال
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <QuestionDialog question={modal} onClose={() => setModal(null)} onSave={save} />
    </>
  );
}

function QuestionDialog({
  question,
  onClose,
  onSave,
}: {
  question: MCQQuestion | null;
  onClose: () => void;
  onSave: (q: MCQQuestion) => void;
}) {
  const [draft, setDraft] = useState<MCQQuestion | null>(question);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  useEffect(() => {
    setDraft(question);
    setStep(1);
  }, [question]);
  if (!draft) return null;
  const set = (patch: Partial<MCQQuestion>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setOpt = (i: number, v: string) => set({ options: draft.options.map((o, idx) => (idx === i ? v : o)) });
  const addOpt = () => {
    if (draft.options.length >= 6) return;
    set({ options: [...draft.options, ""] });
  };
  const delOpt = (i: number) => {
    const opts = draft.options.filter((_, idx) => idx !== i);
    let answerIndex = draft.answerIndex;
    if (i < draft.answerIndex) {
      answerIndex = draft.answerIndex - 1;
    } else if (i === draft.answerIndex) {
      answerIndex = Math.min(draft.answerIndex, Math.max(0, opts.length - 1));
    }
    set({ options: opts, answerIndex });
  };

  const clean = draft.options.map((o) => o.trim());
  const questionOk = draft.question.trim().length > 3;
  const allOptsFilled = clean.every(Boolean) && clean.length >= 2;
  const answerOk = !!clean[draft.answerIndex];
  const valid = questionOk && allOptsFilled && answerOk;

  const canGo = (target: 1 | 2 | 3) => {
    if (target === 1) return true;
    if (target === 2) return questionOk && allOptsFilled;
    return valid;
  };

  return (
    <Dialog open={!!question} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[94vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="shrink-0 space-y-3 border-b border-border px-6 pb-4 pt-5 text-start">
          <DialogTitle className="text-xl font-black">
            {draft.id ? "ویرایش سوال" : "سوال جدید"}
          </DialogTitle>
          <DialogDescription>قبل از ذخیره، پیش‌نمایش نهایی را مثل هنرجو ببینید.</DialogDescription>
          <ol className="grid grid-cols-3 gap-2 pt-1">
            {STEPS.map((s) => {
              const active = step === s.id;
              const done = step > s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!canGo(s.id)}
                  onClick={() => canGo(s.id) && setStep(s.id)}
                  className={cn(
                    "flex h-10 items-center justify-center gap-1.5 rounded-xl border px-2 text-[11px] font-bold transition-colors sm:text-xs",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border bg-muted/40 text-muted-foreground disabled:opacity-40"
                  )}
                >
                  <span className="tabular-nums">{s.id}</span>
                  <span className="hidden truncate sm:inline">{s.label}</span>
                </button>
              );
            })}
          </ol>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-bold">متن سوال</Label>
                <textarea
                  value={draft.question}
                  onChange={(e) => set({ question: e.target.value })}
                  rows={3}
                  autoFocus
                  placeholder="مثلاً نتیجهٔ اجرای git status چیست؟"
                  className={cn(
                    "w-full resize-y rounded-xl border bg-background px-4 py-3 text-base font-medium leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary",
                    questionOk ? "border-input" : "border-destructive/40"
                  )}
                />
                {!questionOk && (
                  <p className="text-xs font-bold text-destructive">حداقل چند کلمه برای سوال بنویسید.</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex h-8 items-center justify-between gap-3">
                  <Label className="text-sm font-bold">گزینه‌ها ({draft.options.length}/۶)</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    onClick={addOpt}
                    disabled={draft.options.length >= 6}
                  >
                    <Plus className="h-3.5 w-3.5" /> افزودن
                  </Button>
                </div>
                <div className="space-y-2">
                  {draft.options.map((opt, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-2 rounded-2xl border border-border bg-card p-2"
                    >
                      <span className="grid h-9 min-w-9 place-items-center rounded-xl bg-muted px-1 text-sm font-black">
                        {formatOptionLetter(i)}
                      </span>
                      <Input
                        value={opt}
                        onChange={(e) => setOpt(i, e.target.value)}
                        placeholder={`متن گزینه ${formatOptionLetter(i)}`}
                        className="h-10 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive"
                        disabled={draft.options.length <= 2}
                        onClick={() => delOpt(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                {!allOptsFilled && (
                  <p className="text-xs font-bold text-warning">
                    همهٔ گزینه‌های نمایش‌داده‌شده باید پر باشند (حداقل ۲ تا).
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-bold">توضیح بعد از اشتباه (اختیاری)</Label>
                <Input
                  value={draft.explanation}
                  onChange={(e) => set({ explanation: e.target.value })}
                  placeholder="چرا این پاسخ درست است؟"
                  className="h-11 rounded-2xl"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm font-bold text-muted-foreground">گزینهٔ درست را علامت بزنید.</p>
              <p className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-base font-black leading-snug">
                {draft.question}
              </p>
              <div className="space-y-2">
                {draft.options.map((o, i) => {
                  const isAns = i === draft.answerIndex;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => set({ answerIndex: i })}
                      className={cn(
                        "grid w-full grid-cols-[2.75rem_minmax(0,1fr)_1.25rem] items-center gap-3 rounded-xl border px-4 py-3 text-right text-sm font-bold transition-colors",
                        isAns
                          ? "border-success bg-success/10 text-success"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-8 min-w-8 place-items-center rounded-full px-1 text-[11px] font-black",
                          isAns ? "bg-success text-success-foreground" : "bg-muted"
                        )}
                      >
                        {isAns ? <Check className="h-4 w-4" /> : formatOptionLetter(i)}
                      </span>
                      <span className="min-w-0 truncate">{o}</span>
                      <span className="flex justify-end">
                        {isAns && <Check className="h-4 w-4" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!answerOk && (
                <p className="text-xs font-bold text-destructive">پاسخ درست باید گزینه‌ای با متن غیرخالی باشد.</p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <Eye className="h-4 w-4 shrink-0" />
                <span>پیش‌نمایش نهایی — همان چیزی که هنرجو در آزمون می‌بیند</span>
              </div>

              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
                  <Badge variant="secondary" className="h-6 w-6 justify-center rounded-md p-0">
                    ?
                  </Badge>
                  <p className="min-w-0 flex-1 font-medium leading-snug">{draft.question}</p>
                </div>
                <div className="space-y-2 p-4">
                  {draft.options.map((opt, oi) => {
                    const isAns = oi === draft.answerIndex;
                    return (
                      <div
                        key={oi}
                        className={cn(
                          "flex items-center gap-3 rounded-md border px-4 py-3 text-sm",
                          isAns
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-semibold",
                            isAns
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground"
                          )}
                        >
                          {formatOptionLetter(oi)}
                        </span>
                        <span className="min-w-0 flex-1">{opt}</span>
                        {isAns && (
                          <Badge variant="success" className="shrink-0 text-[10px]">
                            پاسخ درست
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
                {draft.explanation.trim() && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-bold text-foreground">توضیح اشتباه: </span>
                    {draft.explanation}
                  </div>
                )}
              </div>

              <ul className="grid gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground sm:grid-cols-3">
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-success" /> {draft.options.length} گزینه
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-success" /> پاسخ {formatOptionLetter(draft.answerIndex)}
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-success" />
                  {draft.explanation.trim() ? "توضیح دارد" : "بدون توضیح"}
                </li>
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button variant="outline" className="h-10" onClick={onClose}>
            انصراف
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="outline" className="h-10" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
                قبلی
              </Button>
            )}
            {step < 3 ? (
              <Button
                className="h-10"
                disabled={step === 1 ? !questionOk || !allOptsFilled : !answerOk}
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              >
                {step === 1 ? "بعدی · پاسخ درست" : "بعدی · پیش‌نمایش"}
              </Button>
            ) : (
              <Button disabled={!valid} className="h-10 gap-1.5" onClick={() => onSave(draft)}>
                <Save className="h-4 w-4" /> تأیید و {draft.id ? "ذخیره" : "ساخت"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
