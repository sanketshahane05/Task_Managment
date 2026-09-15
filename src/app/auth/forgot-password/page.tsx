"use client";
import Link from "next/link";
import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
export default function ForgotPassword(){
 const [email,setEmail]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 return <main className="workspace-theme flex min-h-screen items-center justify-center bg-slate-950 p-4"><form className="w-full max-w-md space-y-4 rounded-2xl bg-white p-8 text-slate-900" onSubmit={async e=>{e.preventDefault();if(!supabase)return;setBusy(true);try{const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:`${location.origin}/auth/callback`});setMessage(error?'Unable to send a reset email right now. Please try again later or contact your admin.':'If an account exists for that email, you will receive a password reset link.');}catch{setMessage('Unable to connect. Please try again.');}finally{setBusy(false);}}}><h1 className="text-2xl font-bold">Reset your password</h1><p className="text-sm text-slate-500">Enter your work email. If a previous link expired, request a new one here.</p><label className="block">Work email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>{message&&<p role="status" className="text-sm">{message}</p>}<button disabled={busy} className="w-full rounded-lg bg-indigo-600 p-3 font-semibold text-white disabled:opacity-50">{busy?'Sending…':'Send reset link'}</button><Link className="block text-sm text-indigo-600" href="/">Back to sign in</Link></form></main>;
}


