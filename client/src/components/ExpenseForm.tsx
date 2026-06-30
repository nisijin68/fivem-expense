import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Expense, AuthUser } from '../types';
import { formatAmount, parseAmount, parseAmountNumber } from '../utils';
import { supabase } from '../lib/supabaseClient';

interface ExpenseFormProps {
  user: AuthUser | null;
  onSubmissionComplete: () => void;
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  profileName?: string;
  isAdmin?: boolean;
}

// 新サイト移行日（この日以降、一般ユーザーは旧サイトでの送信不可）
const NEW_SITE_CUTOVER = new Date('2026-07-01T00:00:00+09:00');
const NEW_SITE_URL = 'https://fivem-portal.vercel.app';

const ExpenseForm: React.FC<ExpenseFormProps> = ({ user, onSubmissionComplete, expenses, setExpenses, profileName: parentProfileName, isAdmin }) => {
  const [profileName, setProfileName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionMode, setSubmissionMode] = useState<'auto' | 'blocked' | 'allowed'>('auto');

  useEffect(() => {
    const fetchSubmissionMode = async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'expense_submission_mode')
        .single();

      if (!error && (data?.value === 'blocked' || data?.value === 'allowed')) {
        setSubmissionMode(data.value);
      }
    };

    fetchSubmissionMode();
  }, []);

  const isSubmissionBlocked = !isAdmin && (
    submissionMode === 'blocked' ||
    (submissionMode === 'auto' && new Date() >= NEW_SITE_CUTOVER)
  );

  const totalAmount = useMemo(() => {
    return expenses.reduce((sum, expense) => {
      const amount = parseAmountNumber(expense.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
  }, [expenses]);

  // プロファイル名を取得
  useEffect(() => {
    const fetchProfileName = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .single();

        if (!error && data && data.name) {
          setProfileName(data.name);
        }
      } catch (error) {
        console.error('プロファイル名の取得に失敗:', error);
      }
    };

    fetchProfileName();
  }, [user]);

  const handleInputChange = useCallback((index: number, field: keyof Expense, value: string) => {
    setExpenses(prev => {
      const newExpenses = [...prev];
      newExpenses[index] = { ...newExpenses[index], [field]: value };
      return newExpenses;
    });
  }, [setExpenses]);

  const handleClearRow = useCallback((index: number) => {
    setExpenses(prev => {
      const newExpenses = [...prev];
      newExpenses[index] = { type: 'one_time', from_station: '', to_station: '', amount: '', start_date: '', end_date: '', workplace: '' };
      return newExpenses;
    });
  }, [setExpenses]);

  const handleAddRow = useCallback(() => {
    setExpenses(prev => {
      return [...prev, { type: 'one_time', from_station: '', to_station: '', amount: '', start_date: '', end_date: '', workplace: '' }];
    });
  }, [setExpenses]);

  const handleRemoveRow = useCallback((index: number) => {
    setExpenses(prev => {
      const newExpenses = [...prev];
      newExpenses.splice(index, 1);
      return newExpenses;
    });
  }, [setExpenses]);

  const handleMakeRoundTrip = useCallback((index: number) => {
    const originalExpense = expenses[index];
    if (!originalExpense || !originalExpense.from_station || !originalExpense.to_station) {
      alert('往復にするには、出発駅と到着駅を入力してください。');
      return;
    }

    setExpenses(prev => {
      const newExpenses = [...prev];
      const returnExpense: Expense = {
        ...originalExpense,
        from_station: originalExpense.to_station,
        to_station: originalExpense.from_station,
        start_date: originalExpense.start_date,
        end_date: originalExpense.end_date
      };
      newExpenses.splice(index + 1, 0, returnExpense);
      return newExpenses;
    });
  }, [expenses, setExpenses]);

  const handleSubmit = async () => {
    if (!user) return;
    if (isSubmissionBlocked) return;

    // 送信中フラグをオンにする
    setIsSubmitting(true);

    const expensesToSubmit = expenses.filter(e =>
      e.from_station.trim() ||
      e.to_station.trim() ||
      e.amount.trim() ||
      (e.type !== 'regular' && e.start_date?.trim()) ||
      (e.type === 'regular' && (e.start_date?.trim() || e.end_date?.trim())) ||
      e.transportation?.trim()
    );

    if (expensesToSubmit.length === 0) {
      alert('申請する項目がありません。');
      setIsSubmitting(false);
      return;
    }

    // 定期券と他の申請タイプの混在チェック
    const hasRegular = expensesToSubmit.some(expense => expense.type === 'regular');
    const hasOther = expensesToSubmit.some(expense => expense.type !== 'regular');
    
    if (hasRegular && hasOther) {
      alert('定期券の申請と他の申請（単発・出張）は混ぜて申請できません。\n別々に申請してください。');
      setIsSubmitting(false);
      return;
    }

    // バリデーション
    for (const expense of expensesToSubmit) {
      if (!expense.from_station.trim()) {
        alert('出発駅を入力してください。');
        setIsSubmitting(false);
        return;
      }
      if (!expense.to_station.trim()) {
        alert('帰着駅を入力してください。');
        setIsSubmitting(false);
        return;
      }
      const parsedAmount = parseAmountNumber(expense.amount);
      if (!expense.amount.trim() || isNaN(parsedAmount)) {
        alert('金額を正しく入力してください。');
        setIsSubmitting(false);
        return;
      }
      if (expense.type === 'one_time' || expense.type === 'business_trip') {
        if (!expense.start_date?.trim()) {
          alert('単発または出張の場合、利用日を入力してください。');
          setIsSubmitting(false);
          return;
        }
      } else if (expense.type === 'regular') {
        if (!expense.start_date?.trim() || !expense.end_date?.trim()) {
          alert('定期の場合、開始日と終了日を入力してください。');
          setIsSubmitting(false);
          return;
        }
      }
      if (!expense.transportation?.trim()) {
        alert('交通機関を入力してください。');
        setIsSubmitting(false);
        return;
      }
      if (!expense.workplace?.trim()) {
        alert('勤務先を入力してください。');
        setIsSubmitting(false);
        return;
      }
    }

    const { error } = await supabase.from('expenses').insert([
      { user_id: user.id, expenses_data: expensesToSubmit, status: 'pending' }
    ]);

    if (error) {
      alert('登録に失敗しました: ' + error.message);
      setIsSubmitting(false);
    } else {
      // 🚀 Slack通知を送信
      try {
        // Slackメッセージを作成（シンプル版）
        const applicantName = (parentProfileName || profileName).trim() || user.email;
        const totalAmount = expensesToSubmit.reduce((sum, exp) => sum + (parseAmountNumber(exp.amount || '0') || 0), 0);
        
        const slackPayload = {
          expense: {
            user_name: applicantName,
            date: new Date().toLocaleDateString('ja-JP'),
            total_amount: totalAmount,
            items_count: expensesToSubmit.length,
            items: expensesToSubmit.map(item => ({
              type: item.type,
              from_station: item.from_station,
              to_station: item.to_station,
              amount: item.amount,
              start_date: item.start_date,
              end_date: item.end_date,
              notes: item.notes,
              transportation: item.transportation
            }))
          }
        };

        console.log('Slack通知URL:', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/slack-notify`);
        console.log('Slack通知ペイロード:', JSON.stringify(slackPayload, null, 2));

        const slackResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/slack-notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify(slackPayload)
        });
        
        console.log('Slack通知レスポンス:', slackResponse.status, slackResponse.statusText);
        
        if (!slackResponse.ok) {
          const errorText = await slackResponse.text();
          console.error('Slack通知エラー:', errorText);
          throw new Error(`Slack通知失敗: ${slackResponse.status} - ${errorText}`);
        } else {
          const responseData = await slackResponse.json();
          console.log('Slack通知成功:', responseData);
        }
      } catch (slackError) {
        console.error('Slack通知の送信に失敗:', slackError);
        // エラーでも申請は成功させる
      }
      
      alert('交通費を登録しました。承認をお待ちください。');
      setExpenses([{ type: 'one_time', from_station: '', to_station: '', amount: '', start_date: '', end_date: '', workplace: '' }]);
      onSubmissionComplete();

      // 3秒後に送信ボタンを再度有効化
      setTimeout(() => {
        setIsSubmitting(false);
      }, 3000);
    }
  };

  return (
    <div>
      <h2 style={{ textAlign: 'center' }}>ファイブM 交通費精算フォーム</h2>

      {isSubmissionBlocked && (
        <div style={{
          backgroundColor: '#fff3cd',
          border: '2px solid #f5c518',
          borderRadius: '8px',
          padding: '16px',
          margin: '16px 0',
          fontSize: '14px',
          lineHeight: '1.7',
          color: '#664d03'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '15px', marginBottom: '8px' }}>
            【重要】交通費申請は新サイトに移行しました
          </div>
          <div style={{ marginBottom: '12px' }}>
            2026年7月1日（水）より、交通費申請は新しいスタッフ専用サイトで行っていただくことになりました。
            旧サイト（このサイト）では7/1以降、交通費申請を受け付けておりません。お手数ですが、新サイトからログインして申請してください。
          </div>

          <div style={{
            backgroundColor: '#fffbe6',
            border: '1px solid #f0d878',
            borderRadius: 6,
            padding: '12px',
            marginBottom: '12px'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>■ ログイン方法</div>
            <div>・メールアドレス：このサイトにご登録いただいているメールアドレス</div>
            <div style={{ marginBottom: '6px' }}>
              ・初期パスワード：メールアドレスの「@」より前の部分<br />
              　（例：tanaka@example.com の場合 → <span style={{ fontWeight: 'bold' }}>tanaka</span>）
            </div>
            <div>
              ※ログイン後は、画面右上の名前 →「アカウント設定」から、必ずご自身のパスワードに変更してください。
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            ログインできない・パスワードを忘れた場合は、新サイトのログイン画面の「パスワードを忘れた場合」からリセットできます。
            解決しない場合は管理者にご連絡ください。
          </div>

          <a
            href={NEW_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '10px 16px',
              background: '#664d03',
              color: '#fff',
              borderRadius: 4,
              textDecoration: 'none',
              fontWeight: 'bold'
            }}
          >
            新サイトへ移動する →
          </a>
        </div>
      )}

      <div style={{
        backgroundColor: '#f8f9fa', 
        border: '1px solid #dee2e6', 
        borderRadius: '8px', 
        padding: '16px', 
        margin: '16px 0',
        fontSize: '14px',
        lineHeight: '1.6'
      }}>
        <div style={{ marginBottom: '8px', color: '#000' }}>
          📋 申請は「まとめて申請」 ・ 「都度申請」どちらでも大丈夫です。<br />
          申請履歴をテンプレートとして使用できます。
        </div>
        <div style={{ 
          padding: '12px', 
          backgroundColor: '#fff3cd', 
          border: '1px solid #ffeaa7', 
          borderRadius: '6px',
          color: '#856404'
        }}>
          <strong>⚠️</strong> 定期券の申請と他の申請（単発・出張）は混ぜないでください。別々に申請してください。
        </div>
      </div>
      
      <form>
        {expenses.map((expense, index) => (
          <div key={index} className="expense-row">
            <span className="expense-number">{index + 1}</span>
            <select
              value={expense.type}
              onChange={(e) => handleInputChange(index, 'type', e.target.value as 'regular' | 'business_trip' | 'one_time')}
              className="expense-input single-select"
            >
              <option value="one_time">通勤（単発）</option>
              <option value="regular">定期</option>
              <option value="business_trip">出張（園指導等）</option>
            </select>
            
            {(expense.type === 'one_time' || expense.type === 'business_trip') && (
              <div className="date-input-wrapper" data-hasvalue={Boolean(expense.start_date)}>
                <input
                  type="date"
                  value={expense.start_date || ''}
                  onChange={(e) => handleInputChange(index, 'start_date', e.target.value)}
                  className="expense-input date-input"
                  required
                />
                <span className="date-placeholder">利用日</span>
              </div>
            )}
            
            {expense.type === 'regular' && (
              <>
                <div className="date-input-wrapper" data-hasvalue={Boolean(expense.start_date)}>
                  <input
                    type="date"
                    value={expense.start_date || ''}
                    onChange={(e) => handleInputChange(index, 'start_date', e.target.value)}
                    className="expense-input date-input"
                    required
                  />
                  <span className="date-placeholder">開始日</span>
                </div>
                <div className="date-input-wrapper" data-hasvalue={Boolean(expense.end_date)}>
                  <input
                    type="date"
                    value={expense.end_date || ''}
                    onChange={(e) => handleInputChange(index, 'end_date', e.target.value)}
                    className="expense-input date-input"
                    required
                  />
                  <span className="date-placeholder">終了日</span>
                </div>
              </>
            )}
            
            <input
              type="text"
              placeholder="交通機関(JR,阪急,市バス)"
              value={expense.transportation || ''}
              onChange={(e) => handleInputChange(index, 'transportation', e.target.value)}
              className="expense-input transportation-input"
            />
            
            <input
              type="text"
              placeholder="出発駅"
              value={expense.from_station}
              onChange={(e) => handleInputChange(index, 'from_station', e.target.value)}
              className="expense-input"
            />
            
            <input
              type="text"
              placeholder="帰着駅"
              value={expense.to_station}
              onChange={(e) => handleInputChange(index, 'to_station', e.target.value)}
              className="expense-input"
            />
            
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="金額"
              value={formatAmount(expense.amount)}
              onChange={(e) => handleInputChange(index, 'amount', parseAmount(e.target.value))}
              className="expense-input amount-input"
            />
            
            <input
              type="text"
              placeholder="勤務先"
              value={expense.workplace || ''}
              onChange={(e) => handleInputChange(index, 'workplace', e.target.value)}
              className="expense-input workplace-input"
              style={{ maxWidth: '120px' }}
            />
            
            <input
              type="text"
              placeholder={expense.type === 'regular' ? "備考（経由地がある場合はご記入ください）" : "備考"}
              value={expense.notes || ''}
              onChange={(e) => handleInputChange(index, 'notes', e.target.value)}
              className="expense-input notes-input"
            />
            
            <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
              <button 
                type="button" 
                onClick={() => handleClearRow(index)} 
                style={{ 
                  width: 24, 
                  height: 24, 
                  background: 'black', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '50%', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  justifyContent: 'center', 
                  alignItems: 'center', 
                  fontSize: '0.8em', 
                  fontWeight: 'bold' 
                }}
              >
                x
              </button>
              
              {expense.type !== 'regular' && (
                <button 
                  type="button" 
                  translate="no"
                  onClick={() => handleMakeRoundTrip(index)} 
                  style={{ 
                    padding: '8px 12px', 
                    background: '#28a745', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: 4, 
                    cursor: 'pointer' 
                  }}
                >
                  往復
                </button>
              )}
              
              {expenses.length > 1 && (
                <button 
                  type="button" 
                  onClick={() => handleRemoveRow(index)} 
                  style={{ 
                    width: 24, 
                    height: 24, 
                    background: '#dc3545', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '50%', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    fontSize: '0.8em', 
                    fontWeight: 'bold' 
                  }}
                >
                  -
                </button>
              )}
            </div>
          </div>
        ))}
        
        <button 
          type="button" 
          onClick={handleAddRow} 
          style={{ 
            width: '100%', 
            padding: 10, 
            marginTop: 10, 
            background: '#6c757d', 
            color: 'white', 
            border: 'none', 
            borderRadius: 4, 
            cursor: 'pointer' 
          }}
        >
          行を追加
        </button>
        
        <div style={{ textAlign: 'right', marginTop: 10, fontSize: '1.2em', fontWeight: 'bold' }}>
          合計金額: {formatAmount(totalAmount.toString())}円
        </div>
        
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || isSubmissionBlocked}
          style={{
            width: '100%',
            padding: 10,
            marginTop: 20,
            background: (isSubmitting || isSubmissionBlocked) ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: (isSubmitting || isSubmissionBlocked) ? 'not-allowed' : 'pointer',
            opacity: (isSubmitting || isSubmissionBlocked) ? 0.6 : 1
          }}
        >
          {isSubmissionBlocked ? '新サイトをご利用ください' : (isSubmitting ? '送信中...' : '申請する')}
        </button>
      </form>
    </div>
  );
};

export default ExpenseForm;
