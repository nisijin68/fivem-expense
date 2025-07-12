import React, { useState, useEffect, useCallback } from 'react';
import type { Expense, AuthUser } from '../types';
import { formatAmount, parseAmount } from '../utils';
import { supabase } from '../lib/supabaseClient';

interface ExpenseFormProps {
  user: AuthUser | null;
  onSubmissionComplete: () => void;
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  profileName?: string;
}

const ExpenseForm: React.FC<ExpenseFormProps> = ({ user, onSubmissionComplete, expenses, setExpenses, profileName: parentProfileName }) => {
  const [totalAmount, setTotalAmount] = useState(0);
  const [profileName, setProfileName] = useState('');

  // 合計金額を計算
  useEffect(() => {
    const calculatedTotal = expenses.reduce((sum, expense) => {
      const amount = parseInt(expense.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
    setTotalAmount(calculatedTotal);
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
      newExpenses[index] = { type: 'one_time', from_station: '', to_station: '', amount: '', start_date: '', end_date: '' };
      return newExpenses;
    });
  }, [setExpenses]);

  const handleAddRow = useCallback(() => {
    setExpenses(prev => {
      const lastExpense = prev[prev.length - 1];
      const newFromStation = lastExpense ? lastExpense.to_station : '';
      return [...prev, { type: 'one_time', from_station: newFromStation, to_station: '', amount: '', start_date: '', end_date: '' }];
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
      return;
    }

    // バリデーション
    for (const expense of expensesToSubmit) {
      if (!expense.from_station.trim()) {
        alert('出発駅を入力してください。');
        return;
      }
      if (!expense.to_station.trim()) {
        alert('帰着駅を入力してください。');
        return;
      }
      const parsedAmount = parseInt(expense.amount.replace(/,/g, ''), 10);
      if (!expense.amount.trim() || isNaN(parsedAmount)) {
        alert('金額を正しく入力してください。');
        return;
      }
      if (expense.type === 'one_time' || expense.type === 'business_trip') {
        if (!expense.start_date?.trim()) {
          alert('単発または出張の場合、利用日を入力してください。');
          return;
        }
      } else if (expense.type === 'regular') {
        if (!expense.start_date?.trim() || !expense.end_date?.trim()) {
          alert('定期の場合、開始日と終了日を入力してください。');
          return;
        }
      }
      if (!expense.transportation?.trim()) {
        alert('交通機関を入力してください。');
        return;
      }
    }

    const { error } = await supabase.from('expenses').insert([
      { user_id: user.id, expenses_data: expensesToSubmit, status: 'pending' }
    ]);

    if (error) {
      alert('登録に失敗しました: ' + error.message);
    } else {
      // 🚀 Slack通知を送信
      try {
        // 申請項目の種類のみを作成（単発、定期、出張のみ）
        const expenseTypes = expensesToSubmit.map(item => {
          return item.type === 'regular' ? '定期' : item.type === 'business_trip' ? '出張' : '単発';
        }).join('、');
        
        // Slackメッセージを作成（シンプル版）
        const applicantName = (parentProfileName || profileName).trim() || user.email;
        const message = {
          text: `新しい交通費申請\n申請者: ${applicantName}\n申請日: ${new Date().toLocaleDateString('ja-JP')}\n申請内容: ${expenseTypes}\n項目数: ${expensesToSubmit.length}件`
        };
        
        // プロキシサーバー経由でSlackに送信
        await fetch('http://localhost:3001/api/slack-notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message })
        });
        
        console.log('Slack通知を送信しました');
      } catch (slackError) {
        console.error('Slack通知の送信に失敗:', slackError);
        // エラーでも申請は成功させる
      }
      
      alert('交通費を登録しました。承認をお待ちください。');
      setExpenses([{ type: 'one_time', from_station: '', to_station: '', amount: '', start_date: '', end_date: '' }]);
      onSubmissionComplete();
    }
  };

  return (
    <div>
      <h2 style={{ textAlign: 'center' }}>ファイブM 交通費精算フォーム</h2>
      <form>
        {expenses.map((expense, index) => (
          <div key={index} className="expense-row">
            <select
              value={expense.type}
              onChange={(e) => handleInputChange(index, 'type', e.target.value as 'regular' | 'business_trip' | 'one_time')}
              className="expense-input"
            >
              <option value="one_time">単発</option>
              <option value="regular">定期</option>
              <option value="business_trip">出張</option>
            </select>
            
            {(expense.type === 'one_time' || expense.type === 'business_trip') && (
              <div className="date-input-wrapper">
                <input
                  type="date"
                  value={expense.start_date || ''}
                  onChange={(e) => handleInputChange(index, 'start_date', e.target.value)}
                  className="expense-input date-input"
                />
                {!expense.start_date && (
                  <span className="date-placeholder">利用日</span>
                )}
              </div>
            )}
            
            {expense.type === 'regular' && (
              <>
                <div className="date-input-wrapper">
                  <input
                    type="date"
                    value={expense.start_date || ''}
                    onChange={(e) => handleInputChange(index, 'start_date', e.target.value)}
                    className="expense-input date-input"
                  />
                  {!expense.start_date && (
                    <span className="date-placeholder">開始日</span>
                  )}
                </div>
                <div className="date-input-wrapper">
                  <input
                    type="date"
                    value={expense.end_date || ''}
                    onChange={(e) => handleInputChange(index, 'end_date', e.target.value)}
                    className="expense-input date-input"
                  />
                  {!expense.end_date && (
                    <span className="date-placeholder">終了日</span>
                  )}
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
              placeholder="備考"
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
              
              <button 
                type="button" 
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
          style={{ 
            width: '100%', 
            padding: 10, 
            marginTop: 20, 
            background: '#007bff', 
            color: 'white', 
            border: 'none', 
            borderRadius: 4, 
            cursor: 'pointer' 
          }}
        >
          申請する
        </button>
      </form>
    </div>
  );
};

export default ExpenseForm;